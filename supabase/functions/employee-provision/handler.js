import {
  DEPARTMENT_OPTIONS,
  POSITION_OPTIONS,
} from '../../../src/auth/employeeAuthDomain.js'
import { createAdminClient as createDefaultAdminClient } from '../_shared/clients.ts'
import {
  createTemporaryPassword as createDefaultTemporaryPassword,
  deriveAuthEmail as deriveDefaultAuthEmail,
  requirePersonnelAdministrator as requireDefaultPersonnelAdministrator,
} from '../_shared/employee-auth.ts'
import {
  EdgeSecurityError,
  jsonResponse,
  safeErrorResponse,
} from '../_shared/responses.ts'

const MAX_REQUEST_BYTES = 32 * 1024
const MAX_AUTH_PAGES = 100
const AUTH_PAGE_SIZE = 100
export const HANDLER_DEADLINE_MS = 45_000
const PROVISION_PASSWORD_DOMAIN =
  'shengwang-erp:employee-provisioning-password:v1'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export const PROFILE_FIELDS = Object.freeze([
  'name',
  'gender',
  'birthDate',
  'nationality',
  'employmentStatus',
  'hireDate',
  'resignDate',
  'department',
  'position',
  'level',
  'phone',
  'emergencyContactName',
  'emergencyContactPhone',
  'currentAddress',
  'visaAgency',
  'visaType',
  'visaExpireDate',
  'passportNumber',
  'residenceCardNumber',
  'baseSalary',
  'dailySalary',
  'hourlyWage',
  'salaryRemark',
  'wecomUserId',
  'wecomDepartmentId',
  'wecomDepartmentName',
  'remark',
])

const PROFILE_FIELD_SET = new Set(PROFILE_FIELDS)
const DATE_FIELDS = new Set([
  'birthDate',
  'hireDate',
  'resignDate',
  'visaExpireDate',
])
const NUMBER_FIELDS = new Set(['baseSalary', 'dailySalary', 'hourlyWage'])
const IDENTITY_FIELDS = new Set([
  'gender',
  'birthDate',
  'nationality',
  'emergencyContactName',
  'emergencyContactPhone',
  'currentAddress',
  'visaAgency',
  'visaType',
  'visaExpireDate',
  'passportNumber',
  'residenceCardNumber',
])
const SALARY_FIELDS = new Set([
  'baseSalary',
  'dailySalary',
  'hourlyWage',
  'salaryRemark',
])
const EMPLOYMENT_STATUSES = new Set(['在职', '离职', '休假', '停工'])

function inputError(code = 'PROVISION_INPUT_INVALID') {
  return new EdgeSecurityError(code, '员工资料格式无效', 400)
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
      new DOMException('Employee provision deadline exceeded', 'TimeoutError'),
    )
  }, HANDLER_DEADLINE_MS)
  return {
    signal: controller.signal,
    close: () => globalThis.clearTimeout(timer),
  }
}

function assertProvisionDeadline(signal, code = 'PROVISION_AUTH_FAILED') {
  if (signal.aborted) {
    throw serviceError(code, '员工账号创建失败，请稍后重试')
  }
}

export async function deriveProvisioningPassword(
  requestId,
  employeeNumber,
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
          `${PROVISION_PASSWORD_DOMAIN}\0${requestId}\0${employeeNumber}`,
        ),
      ),
    )
    return createDefaultTemporaryPassword({ randomBytes: () => digest })
  } catch (error) {
    if (error instanceof EdgeSecurityError) throw error
    throw serviceError('PROVISION_AUTH_FAILED', '员工账号创建失败，请稍后重试')
  }
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
}

function normalizeOptionalString(value, maximum = 500) {
  if (value === null || value === '') return null
  if (typeof value !== 'string') throw inputError()
  const normalized = value.trim()
  if (!normalized || normalized.length > maximum) throw inputError()
  return normalized
}

export function validateProfileInput(profile, { partial = false } = {}) {
  if (!isPlainObject(profile)) throw inputError()
  const keys = Object.keys(profile)
  if (
    (partial && keys.length === 0) ||
    keys.some((key) => !PROFILE_FIELD_SET.has(key))
  ) {
    throw inputError()
  }
  if (
    !partial &&
    ['name', 'department', 'position'].some((key) =>
      !Object.hasOwn(profile, key)
    )
  ) {
    throw inputError()
  }

  const normalized = {}
  for (const key of keys) {
    const value = profile[key]
    if (key === 'name') {
      if (
        typeof value !== 'string' || !value.trim() || value.trim().length > 100
      ) {
        throw inputError()
      }
      normalized.name = value.trim()
    } else if (key === 'department') {
      if (!DEPARTMENT_OPTIONS.includes(value)) throw inputError()
      normalized.department = value
    } else if (key === 'position') {
      if (!POSITION_OPTIONS.includes(value)) throw inputError()
      normalized.position = value
    } else if (key === 'employmentStatus') {
      if (!EMPLOYMENT_STATUSES.has(value)) throw inputError()
      normalized.employmentStatus = value
    } else if (DATE_FIELDS.has(key)) {
      if (value === null || value === '') normalized[key] = null
      else if (typeof value === 'string' && validDate(value)) {
        normalized[key] = value
      } else throw inputError()
    } else if (NUMBER_FIELDS.has(key)) {
      if (value === null || value === '') normalized[key] = null
      else if (
        typeof value === 'number' && Number.isFinite(value) && value >= 0 &&
        value <= 1e12
      ) {
        normalized[key] = value
      } else throw inputError()
    } else {
      const maximum = ['remark', 'salaryRemark'].includes(key) ? 2000 : 500
      normalized[key] = normalizeOptionalString(value, maximum)
    }
  }
  return normalized
}

function permissionKeys(actor) {
  const keys = actor?.effectivePermissionKeys ??
    actor?.effective_permission_keys
  return Array.isArray(keys) ? new Set(keys) : new Set()
}

export function assertSensitiveProfilePermissions(actor, profile) {
  if ((actor?.employeeNumber ?? actor?.employee_number) === 'SW-000') return
  const keys = permissionKeys(actor)
  if (keys.has('all')) return
  const submitted = Object.keys(profile)
  const identityRequired = submitted.some((key) => IDENTITY_FIELDS.has(key))
  const salaryRequired = submitted.some((key) => SALARY_FIELDS.has(key))
  if (
    (identityRequired && !keys.has('sensitive.employee_identity_update')) ||
    (salaryRequired && !keys.has('sensitive.salary_update'))
  ) {
    throw new EdgeSecurityError(
      'SENSITIVE_PERMISSION_REQUIRED',
      '没有修改敏感员工资料的权限',
      403,
    )
  }
}

function declaredBodyTooLarge(request) {
  const length = Number(request.headers.get('content-length'))
  return Number.isFinite(length) && length > MAX_REQUEST_BYTES
}

async function readProvisionInput(request) {
  if (request.method !== 'POST') {
    throw new EdgeSecurityError('METHOD_NOT_ALLOWED', '请求方法不被允许', 405)
  }
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]
    ?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw new EdgeSecurityError('CONTENT_TYPE_INVALID', '请求格式无效', 415)
  }
  if (declaredBodyTooLarge(request)) {
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
  if (
    !isPlainObject(body) ||
    Object.keys(body).length !== 2 ||
    !Object.hasOwn(body, 'requestId') ||
    !Object.hasOwn(body, 'profile') ||
    typeof body.requestId !== 'string' ||
    !UUID_PATTERN.test(body.requestId)
  ) {
    throw inputError()
  }
  return {
    requestId: body.requestId.toLowerCase(),
    profile: validateProfileInput(body.profile),
  }
}

function safeEmployee(value) {
  if (!isPlainObject(value)) {
    throw serviceError('PROVISION_FAILED', '员工创建失败，请稍后重试')
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
    !UUID_PATTERN.test(employee.id) ||
    !/^SW-\d{3,}$/u.test(employee.employeeNumber) ||
    typeof employee.name !== 'string' ||
    !DEPARTMENT_OPTIONS.includes(employee.department) ||
    !POSITION_OPTIONS.includes(employee.position) ||
    !EMPLOYMENT_STATUSES.has(employee.employmentStatus) ||
    !['active', 'disabled'].includes(employee.accountStatus) ||
    typeof employee.mustChangePassword !== 'boolean'
  ) {
    throw serviceError('PROVISION_FAILED', '员工创建失败，请稍后重试')
  }
  return employee
}

function parseRpcObject(result, code = 'PROVISION_FAILED') {
  if (result?.error || !isPlainObject(result?.data)) {
    throw serviceError(code, '员工创建失败，请稍后重试')
  }
  return result.data
}

export async function reserveEmployeeNumberRpc(client, requestId) {
  const result = await client.rpc('reserve_employee_number', {
    p_request_id: requestId,
  })
  if (
    result?.error || typeof result?.data !== 'string' ||
    !/^SW-\d{3,}$/u.test(result.data)
  ) {
    throw serviceError('PROVISION_FAILED', '员工创建失败，请稍后重试')
  }
  return result.data
}

export async function claimProvisioningRpc(client, input) {
  return parseRpcObject(
    await client.rpc('claim_employee_provisioning', {
      p_request_id: input.requestId,
      p_owner_token: input.ownerToken,
    }),
  )
}

export async function renewProvisioningOwnerRpc(client, input) {
  const result = await client.rpc('renew_employee_provisioning_owner', {
    p_request_id: input.requestId,
    p_owner_token: input.ownerToken,
    p_expected_status: input.expectedStatus,
    p_auth_user_id: input.authUserId ?? null,
  })
  if (result?.error || result?.data !== true) {
    throw new EdgeSecurityError(
      'PROVISION_IN_PROGRESS',
      '员工正在创建，请稍后重试',
      409,
    )
  }
  return true
}

export async function findAuthUsersByEmail(client, email) {
  const matches = []
  for (let page = 1; page <= MAX_AUTH_PAGES; page += 1) {
    const result = await client.auth.admin.listUsers({
      page,
      perPage: AUTH_PAGE_SIZE,
    })
    if (result?.error || !Array.isArray(result?.data?.users)) {
      throw serviceError(
        'PROVISION_AUTH_FAILED',
        '员工账号创建失败，请稍后重试',
      )
    }
    matches.push(...result.data.users.filter((user) => user?.email === email))
    const total = Number(result.data.total)
    if (
      Number.isSafeInteger(total) && total >= 0 &&
      page * AUTH_PAGE_SIZE >= total
    ) {
      return matches
    }
    const hasPaginationMarker = Object.hasOwn(result.data, 'nextPage') ||
      Object.hasOwn(result.data, 'next_page')
    const nextPage = result.data.nextPage ?? result.data.next_page ?? null
    if (hasPaginationMarker && nextPage === null) return matches
    if (result.data.users.length < AUTH_PAGE_SIZE) return matches
  }
  throw serviceError('PROVISION_AUTH_FAILED', '员工账号创建失败，请稍后重试')
}

async function createAuthUserDefault(client, input) {
  const result = await client.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: {
      employeeNumber: input.employeeNumber,
      provisioningRequestId: input.requestId,
    },
  })
  if (result?.error || !result?.data?.user?.id) {
    throw serviceError('PROVISION_AUTH_FAILED', '员工账号创建失败，请稍后重试')
  }
  return result.data.user
}

async function getAuthUserByIdDefault(client, authUserId) {
  const result = await client.auth.admin.getUserById(authUserId)
  if (
    result?.error?.status === 404 || result?.error?.code === 'user_not_found'
  ) {
    return null
  }
  if (result?.error || !result?.data?.user) {
    throw serviceError('PROVISION_AUTH_FAILED', '员工账号创建失败，请稍后重试')
  }
  return result.data.user
}

async function updateAuthPasswordDefault(client, authUserId, password) {
  const result = await client.auth.admin.updateUserById(authUserId, {
    password,
  })
  if (result?.error || result?.data?.user?.id !== authUserId) {
    throw serviceError('PROVISION_AUTH_FAILED', '员工账号创建失败，请稍后重试')
  }
  return true
}

async function recordAuthCreatedRpc(client, input) {
  const result = await client.rpc('record_employee_provisioning_auth', {
    p_request_id: input.requestId,
    p_owner_token: input.ownerToken,
    p_auth_user_id: input.authUserId,
  })
  if (result?.error || result?.data !== true) {
    throw serviceError('PROVISION_FAILED', '员工创建失败，请稍后重试')
  }
  return true
}

async function completeProvisioningRpc(client, input) {
  const result = await client.rpc('complete_employee_provisioning', {
    p_request_id: input.requestId,
    p_owner_token: input.ownerToken,
    p_auth_user_id: input.authUserId,
    p_profile: input.profile,
    p_actor_auth_user_id: input.actorAuthUserId,
  })
  return safeEmployee(parseRpcObject(result, 'PROVISION_PROFILE_FAILED'))
}

async function prepareCompensationRpc(client, input) {
  return parseRpcObject(
    await client.rpc('prepare_employee_provisioning_compensation', {
      p_request_id: input.requestId,
      p_owner_token: input.ownerToken,
      p_auth_user_id: input.authUserId,
      p_safe_error_code: 'PROFILE_INSERT_FAILED',
    }),
    'PROVISION_COMPENSATION_PENDING',
  )
}

async function deleteAuthUserDefault(client, authUserId) {
  const result = await client.auth.admin.deleteUser(authUserId)
  if (result?.error) {
    throw serviceError(
      'PROVISION_COMPENSATION_PENDING',
      '员工创建失败，账号清理待处理',
    )
  }
  return true
}

async function completeCompensationRpc(client, input) {
  const result = await client.rpc(
    'complete_employee_provisioning_compensation',
    {
      p_request_id: input.requestId,
      p_owner_token: input.ownerToken,
      p_auth_user_id: input.authUserId,
    },
  )
  if (result?.error || result?.data !== true) {
    throw serviceError(
      'PROVISION_COMPENSATION_PENDING',
      '员工创建失败，账号清理待处理',
    )
  }
  return true
}

function authUserMatches(user, input) {
  return Boolean(
    user?.id &&
      user.email === input.email &&
      user.user_metadata?.employeeNumber === input.employeeNumber &&
      user.user_metadata?.provisioningRequestId === input.requestId,
  )
}

export function createEmployeeProvisionHandler(dependencies = {}) {
  const requestDeadlineFactory = dependencies.createRequestDeadline ??
    createRequestDeadline
  const operations = {
    randomUUID: dependencies.randomUUID ??
      (() => globalThis.crypto.randomUUID()),
    requirePersonnelAdministrator: dependencies.requirePersonnelAdministrator ??
      requireDefaultPersonnelAdministrator,
    createAdminClient: dependencies.createAdminClient ??
      createDefaultAdminClient,
    reserveEmployeeNumber: dependencies.reserveEmployeeNumber ??
      reserveEmployeeNumberRpc,
    claimProvisioning: dependencies.claimProvisioning ?? claimProvisioningRpc,
    deriveInitialPassword: dependencies.deriveInitialPassword ??
      ((input) =>
        deriveProvisioningPassword(input.requestId, input.employeeNumber)),
    renewProvisioningOwner: dependencies.renewProvisioningOwner ??
      renewProvisioningOwnerRpc,
    deriveAuthEmail: dependencies.deriveAuthEmail ?? deriveDefaultAuthEmail,
    findAuthUsersByEmail: dependencies.findAuthUsersByEmail ??
      findAuthUsersByEmail,
    getAuthUserById: dependencies.getAuthUserById ?? getAuthUserByIdDefault,
    createAuthUser: dependencies.createAuthUser ?? createAuthUserDefault,
    updateAuthPassword: dependencies.updateAuthPassword ??
      updateAuthPasswordDefault,
    recordAuthCreated: dependencies.recordAuthCreated ?? recordAuthCreatedRpc,
    completeProvisioning: dependencies.completeProvisioning ??
      completeProvisioningRpc,
    prepareCompensation: dependencies.prepareCompensation ??
      prepareCompensationRpc,
    deleteAuthUser: dependencies.deleteAuthUser ?? deleteAuthUserDefault,
    completeCompensation: dependencies.completeCompensation ??
      completeCompensationRpc,
  }

  return async function employeeProvisionHandler(request) {
    const deadline = requestDeadlineFactory()
    try {
      const input = await readProvisionInput(request)
      const actor = await operations.requirePersonnelAdministrator(request)
      assertSensitiveProfilePermissions(actor, input.profile)
      const adminClient = await operations.createAdminClient({
        requestSignal: deadline.signal,
      })
      const employeeNumber = await operations.reserveEmployeeNumber(
        adminClient,
        input.requestId,
      )
      const ownerToken = operations.randomUUID()
      if (!UUID_PATTERN.test(ownerToken)) {
        throw serviceError('PROVISION_FAILED', '员工创建失败，请稍后重试')
      }
      const claim = await operations.claimProvisioning(adminClient, {
        requestId: input.requestId,
        ownerToken,
      })
      if (claim.employeeNumber !== employeeNumber) {
        throw new EdgeSecurityError(
          'PROVISION_STATE_CONFLICT',
          '员工创建状态冲突',
          409,
        )
      }
      if (claim.status === 'completed' && claim.employee) {
        return jsonResponse({ employee: safeEmployee(claim.employee) }, 200)
      }
      if (claim.ownerAcquired !== true) {
        throw new EdgeSecurityError(
          'PROVISION_IN_PROGRESS',
          '员工正在创建，请稍后重试',
          409,
        )
      }
      if (
        !['reserved', 'auth_created', 'compensated', 'compensation_pending']
          .includes(claim.status)
      ) {
        throw new EdgeSecurityError(
          'PROVISION_STATE_CONFLICT',
          '员工创建状态冲突',
          409,
        )
      }

      if (claim.status === 'compensation_pending') {
        const email = await operations.deriveAuthEmail(employeeNumber)
        if (!UUID_PATTERN.test(claim.authUserId ?? '')) {
          throw new EdgeSecurityError(
            'PROVISION_STATE_CONFLICT',
            '员工创建状态冲突',
            409,
          )
        }
        let pendingAuthUser
        try {
          pendingAuthUser = await operations.getAuthUserById(
            adminClient,
            claim.authUserId,
          )
        } catch {
          throw serviceError(
            'PROVISION_COMPENSATION_PENDING',
            '员工创建失败，账号清理待处理',
          )
        }
        if (
          pendingAuthUser &&
          !authUserMatches(pendingAuthUser, {
            email,
            employeeNumber,
            requestId: input.requestId,
          })
        ) {
          throw new EdgeSecurityError(
            'PROVISION_STATE_CONFLICT',
            '员工创建状态冲突',
            409,
          )
        }
        const cleanup = await operations.prepareCompensation(adminClient, {
          requestId: input.requestId,
          ownerToken,
          authUserId: claim.authUserId,
        })
        if (cleanup?.employee) {
          return jsonResponse({ employee: safeEmployee(cleanup.employee) }, 200)
        }
        if (cleanup?.cleanupAllowed !== true) {
          throw new EdgeSecurityError(
            'PROVISION_STATE_CONFLICT',
            '员工创建状态冲突',
            409,
          )
        }
        try {
          if (pendingAuthUser) {
            await operations.renewProvisioningOwner(adminClient, {
              requestId: input.requestId,
              ownerToken,
              expectedStatus: 'compensation_pending',
              authUserId: claim.authUserId,
            })
            assertProvisionDeadline(
              deadline.signal,
              'PROVISION_COMPENSATION_PENDING',
            )
            await operations.deleteAuthUser(adminClient, claim.authUserId)
          }
          await operations.completeCompensation(adminClient, {
            requestId: input.requestId,
            ownerToken,
            authUserId: claim.authUserId,
          })
        } catch {
          throw serviceError(
            'PROVISION_COMPENSATION_PENDING',
            '员工创建失败，账号清理待处理',
          )
        }
        throw new EdgeSecurityError(
          'PROVISION_RETRY_REQUIRED',
          '账号清理完成，请重试员工创建',
          409,
        )
      }

      const initialPassword = await operations.deriveInitialPassword({
        requestId: input.requestId,
        employeeNumber,
      })
      const email = await operations.deriveAuthEmail(employeeNumber)
      let authUser
      let createdByThisCall = false
      if (claim.status === 'auth_created') {
        if (!UUID_PATTERN.test(claim.authUserId ?? '')) {
          throw new EdgeSecurityError(
            'PROVISION_STATE_CONFLICT',
            '员工创建状态冲突',
            409,
          )
        }
        authUser = await operations.getAuthUserById(
          adminClient,
          claim.authUserId,
        )
        if (!authUser) {
          const cleanup = await operations.prepareCompensation(adminClient, {
            requestId: input.requestId,
            ownerToken,
            authUserId: claim.authUserId,
          })
          if (cleanup?.employee) {
            return jsonResponse(
              { employee: safeEmployee(cleanup.employee) },
              200,
            )
          }
          if (cleanup?.cleanupAllowed !== true) {
            throw new EdgeSecurityError(
              'PROVISION_STATE_CONFLICT',
              '员工创建状态冲突',
              409,
            )
          }
          try {
            await operations.completeCompensation(adminClient, {
              requestId: input.requestId,
              ownerToken,
              authUserId: claim.authUserId,
            })
          } catch {
            throw serviceError(
              'PROVISION_COMPENSATION_PENDING',
              '员工创建失败，账号清理待处理',
            )
          }
          throw new EdgeSecurityError(
            'PROVISION_RETRY_REQUIRED',
            '账号清理完成，请重试员工创建',
            409,
          )
        }
        if (
          !authUserMatches(authUser, {
            email,
            employeeNumber,
            requestId: input.requestId,
          })
        ) {
          throw new EdgeSecurityError(
            'PROVISION_STATE_CONFLICT',
            '员工创建状态冲突',
            409,
          )
        }
        await operations.renewProvisioningOwner(adminClient, {
          requestId: input.requestId,
          ownerToken,
          expectedStatus: 'auth_created',
          authUserId: authUser.id,
        })
        assertProvisionDeadline(deadline.signal)
        await operations.updateAuthPassword(
          adminClient,
          authUser.id,
          initialPassword,
        )
      } else {
        const matches = await operations.findAuthUsersByEmail(
          adminClient,
          email,
        )
        if (matches.length > 1) {
          throw new EdgeSecurityError(
            'PROVISION_STATE_CONFLICT',
            '员工创建状态冲突',
            409,
          )
        }
        if (matches.length === 1) {
          authUser = matches[0]
          if (
            !authUserMatches(authUser, {
              email,
              employeeNumber,
              requestId: input.requestId,
            })
          ) {
            throw new EdgeSecurityError(
              'PROVISION_STATE_CONFLICT',
              '员工创建状态冲突',
              409,
            )
          }
          await operations.renewProvisioningOwner(adminClient, {
            requestId: input.requestId,
            ownerToken,
            expectedStatus: 'reserved',
            authUserId: null,
          })
          assertProvisionDeadline(deadline.signal)
          await operations.updateAuthPassword(
            adminClient,
            authUser.id,
            initialPassword,
          )
        } else {
          await operations.renewProvisioningOwner(adminClient, {
            requestId: input.requestId,
            ownerToken,
            expectedStatus: 'reserved',
            authUserId: null,
          })
          assertProvisionDeadline(deadline.signal)
          authUser = await operations.createAuthUser(adminClient, {
            email,
            password: initialPassword,
            employeeNumber,
            requestId: input.requestId,
          })
          createdByThisCall = true
        }
      }
      if (!UUID_PATTERN.test(authUser?.id ?? '')) {
        throw serviceError(
          'PROVISION_AUTH_FAILED',
          '员工账号创建失败，请稍后重试',
        )
      }

      try {
        await operations.recordAuthCreated(adminClient, {
          requestId: input.requestId,
          ownerToken,
          authUserId: authUser.id,
        })
        const employee = safeEmployee(
          await operations.completeProvisioning(adminClient, {
            requestId: input.requestId,
            ownerToken,
            authUserId: authUser.id,
            actorAuthUserId: actor.authUserId,
            profile: input.profile,
          }),
        )
        return jsonResponse({ employee, initialPassword }, 201)
      } catch (error) {
        if (!createdByThisCall) throw error
        let cleanup
        try {
          cleanup = await operations.prepareCompensation(adminClient, {
            requestId: input.requestId,
            ownerToken,
            authUserId: authUser.id,
          })
        } catch {
          throw serviceError(
            'PROVISION_COMPENSATION_PENDING',
            '员工创建失败，账号清理待处理',
          )
        }
        if (cleanup?.employee) {
          return jsonResponse({ employee: safeEmployee(cleanup.employee) }, 200)
        }
        if (cleanup?.cleanupAllowed !== true) {
          throw new EdgeSecurityError(
            'PROVISION_STATE_CONFLICT',
            '员工创建状态冲突',
            409,
          )
        }
        try {
          await operations.renewProvisioningOwner(adminClient, {
            requestId: input.requestId,
            ownerToken,
            expectedStatus: 'compensation_pending',
            authUserId: authUser.id,
          })
          assertProvisionDeadline(
            deadline.signal,
            'PROVISION_COMPENSATION_PENDING',
          )
          await operations.deleteAuthUser(adminClient, authUser.id)
          await operations.completeCompensation(adminClient, {
            requestId: input.requestId,
            ownerToken,
            authUserId: authUser.id,
          })
        } catch {
          throw serviceError(
            'PROVISION_COMPENSATION_PENDING',
            '员工创建失败，账号清理待处理',
          )
        }
        throw serviceError(
          'PROVISION_PROFILE_FAILED',
          '员工资料创建失败，请稍后重试',
        )
      }
    } catch (error) {
      return safeErrorResponse(error)
    } finally {
      deadline.close()
    }
  }
}

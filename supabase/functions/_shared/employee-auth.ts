import {
  buildInternalAuthAlias,
  generateTemporaryPassword,
  isEmployeeNumber,
  isPersonnelAdministrator,
  normalizeEmployeeNumber,
} from '../../../src/auth/employeeAuthDomain.js'
import { createUserClient as createDefaultUserClient } from './clients.ts'
import { EdgeSecurityError } from './responses.ts'

type UserClient = {
  auth: {
    getUser: (accessToken: string) => Promise<{
      data?: { user?: { id?: string } | null }
      error?: unknown
    }>
  }
  rpc: (name: string) => Promise<{ data?: unknown; error?: unknown }>
}

type EmployeeAuthDependencies = {
  createUserClient?: (accessToken: string) => Promise<UserClient> | UserClient
  getEnv?: (name: string) => string | undefined
  cryptoImpl?: Crypto
  randomBytes?: (size: number) => Uint8Array
}

type EmployeeProfile = Record<string, unknown>

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

function parseBearerToken(request: Request) {
  const authorization = request.headers.get('authorization')
  const match = authorization?.match(/^Bearer ([^\s,]+)$/iu)
  if (!match) {
    throw new EdgeSecurityError('AUTH_TOKEN_INVALID', '登录凭证无效', 401)
  }
  return match[1]
}

function resolveProfile(data: unknown): EmployeeProfile | null {
  if (Array.isArray(data)) {
    return data.length === 1 && data[0] && typeof data[0] === 'object'
      ? (data[0] as EmployeeProfile)
      : null
  }
  return data && typeof data === 'object' ? (data as EmployeeProfile) : null
}

function profileValue(profile: EmployeeProfile, camelName: string, snakeName: string) {
  return profile[camelName] ?? profile[snakeName]
}

function isDeletedProfile(profile: EmployeeProfile) {
  return Boolean(
    profile.deletedAt ??
      profile.deleted_at ??
      profile.isDeleted ??
      profile.is_deleted ??
      profile.status === 'deleted',
  )
}

function normalizeEffectivePermissions(profile: EmployeeProfile) {
  const permissions = profileValue(
    profile,
    'effectivePermissionKeys',
    'effective_permission_keys',
  )
  if (!Array.isArray(permissions)) return []
  return [...new Set(permissions.filter((permission) => typeof permission === 'string'))]
}

function normalizeActiveProfile(profile: EmployeeProfile, authUserId: string) {
  const employeeNumber = normalizeEmployeeNumber(
    profileValue(profile, 'employeeNumber', 'employee_number'),
  )
  const accountStatus = profileValue(profile, 'accountStatus', 'account_status')
  const employmentStatus = profileValue(profile, 'employmentStatus', 'employment_status')
  const mustChangePassword = profileValue(
    profile,
    'mustChangePassword',
    'must_change_password',
  )

  return {
    ...profile,
    authUserId,
    employeeNumber,
    accountStatus,
    employmentStatus,
    mustChangePassword,
    effectivePermissionKeys: normalizeEffectivePermissions(profile),
  }
}

export async function requireActiveEmployee(
  request: Request,
  dependencies: EmployeeAuthDependencies = {},
) {
  const accessToken = parseBearerToken(request)
  const userClientFactory = dependencies.createUserClient ?? createDefaultUserClient

  let client: UserClient
  try {
    client = (await userClientFactory(accessToken)) as UserClient
  } catch (error) {
    if (error instanceof EdgeSecurityError) throw error
    throw new EdgeSecurityError('AUTH_SERVICE_UNAVAILABLE', '认证服务暂不可用', 503)
  }

  let authResult: Awaited<ReturnType<UserClient['auth']['getUser']>>
  try {
    authResult = await client.auth.getUser(accessToken)
  } catch {
    throw new EdgeSecurityError('AUTH_INVALID', '登录状态无效，请重新登录', 401)
  }

  const authUser = authResult.data?.user
  if (authResult.error || !authUser?.id) {
    throw new EdgeSecurityError('AUTH_INVALID', '登录状态无效，请重新登录', 401)
  }

  let profileResult: Awaited<ReturnType<UserClient['rpc']>>
  try {
    profileResult = await client.rpc('current_employee_profile')
  } catch {
    throw new EdgeSecurityError('AUTH_SERVICE_UNAVAILABLE', '认证服务暂不可用', 503)
  }
  if (profileResult.error) {
    throw new EdgeSecurityError('AUTH_SERVICE_UNAVAILABLE', '认证服务暂不可用', 503)
  }

  const profile = resolveProfile(profileResult.data)
  const linkedAuthUserId = profile ? profileValue(profile, 'authUserId', 'auth_user_id') : undefined
  const employeeNumber = profile
    ? normalizeEmployeeNumber(profileValue(profile, 'employeeNumber', 'employee_number'))
    : ''
  if (
    !profile ||
    (linkedAuthUserId !== undefined && linkedAuthUserId !== authUser.id) ||
    !isEmployeeNumber(employeeNumber)
  ) {
    throw new EdgeSecurityError('EMPLOYEE_NOT_LINKED', '员工账号未关联', 403)
  }
  if (isDeletedProfile(profile)) {
    throw new EdgeSecurityError('EMPLOYEE_INACTIVE', '当前员工状态不可访问', 403)
  }

  const accountStatus = profileValue(profile, 'accountStatus', 'account_status')
  if (accountStatus !== 'active') {
    throw new EdgeSecurityError('ACCOUNT_DISABLED', '账号已停用', 403)
  }

  const employmentStatus = profileValue(profile, 'employmentStatus', 'employment_status')
  if (employmentStatus !== '在职') {
    throw new EdgeSecurityError('EMPLOYEE_INACTIVE', '当前员工状态不可访问', 403)
  }

  const mustChangePassword = profileValue(
    profile,
    'mustChangePassword',
    'must_change_password',
  )
  if (mustChangePassword !== false) {
    throw new EdgeSecurityError('PASSWORD_CHANGE_REQUIRED', '请先修改临时密码', 403)
  }

  return normalizeActiveProfile(profile, authUser.id)
}

export async function requirePersonnelAdministrator(
  request: Request,
  dependencies: EmployeeAuthDependencies = {},
) {
  const employee = await requireActiveEmployee(request, dependencies)
  if (!isPersonnelAdministrator(employee)) {
    throw new EdgeSecurityError('PERSONNEL_ADMIN_REQUIRED', '没有人员管理权限', 403)
  }
  return employee
}

export async function deriveAuthEmail(
  employeeNumber: string,
  dependencies: EmployeeAuthDependencies = {},
) {
  const normalizedEmployeeNumber = normalizeEmployeeNumber(employeeNumber)
  if (!isEmployeeNumber(normalizedEmployeeNumber)) {
    throw new EdgeSecurityError('EMPLOYEE_NUMBER_INVALID', '员工编号格式无效', 400)
  }

  const getEnv = dependencies.getEnv ?? runtimeEnvironment
  const secret = getEnv('AUTH_ID_DERIVATION_SECRET')
  if (!secret?.trim()) throw configurationError()

  try {
    return await buildInternalAuthAlias(
      normalizedEmployeeNumber,
      secret,
      dependencies.cryptoImpl ?? globalThis.crypto,
    )
  } catch {
    throw new EdgeSecurityError('AUTH_SERVICE_UNAVAILABLE', '认证服务暂不可用', 503)
  }
}

export function createTemporaryPassword(dependencies: EmployeeAuthDependencies = {}) {
  try {
    return generateTemporaryPassword(dependencies.randomBytes)
  } catch {
    throw new EdgeSecurityError('AUTH_SERVICE_UNAVAILABLE', '认证服务暂不可用', 503)
  }
}

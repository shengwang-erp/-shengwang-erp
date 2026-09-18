import {
  DEPARTMENT_OPTIONS,
  POSITION_OPTIONS,
} from '../auth/employeeAuthDomain.js'
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const EMPLOYEE_NUMBER_PATTERN = /^SW-\d{3,}$/u

const EMPLOYMENT_STATUSES = new Set(['在职', '离职', '休假', '停工'])
const ACCOUNT_STATUSES = new Set(['active', 'disabled'])
const GENDER_OPTIONS = new Set(['男', '女', '其他'])
const LEVEL_OPTIONS = new Set(['1星', '2星', '3星', '4星', '5星'])

const PROFILE_FIELDS = Object.freeze([
  'name',
  'gender',
  'birthDate',
  'nationality',
  'employmentStatus',
  'attendanceRequired',
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
const DIRECTORY_FIELDS = Object.freeze([
  'id',
  'employeeNumber',
  'name',
  'department',
  'position',
  'employmentStatus',
  'accountStatus',
  'attendanceRequired',
])
const EMPLOYEE_SUMMARY_FIELDS = Object.freeze([
  ...DIRECTORY_FIELDS,
  'mustChangePassword',
])
const PROVISION_EMPLOYEE_SUMMARY_FIELDS = Object.freeze(
  EMPLOYEE_SUMMARY_FIELDS.filter((key) => key !== 'attendanceRequired'),
)
const DETAIL_BASE_FIELDS = Object.freeze([
  ...EMPLOYEE_SUMMARY_FIELDS,
  'legacyEmployeeId',
  'hireDate',
  'resignDate',
  'level',
  'phone',
  'remark',
  'createdAt',
  'updatedAt',
])
const DETAIL_IDENTITY_FIELDS = Object.freeze([
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
const DETAIL_SALARY_FIELDS = Object.freeze([
  'baseSalary',
  'dailySalary',
  'hourlyWage',
  'salaryRemark',
])

const SAFE_ERROR_MESSAGES = Object.freeze({
  CONFIGURATION_ERROR: '人员管理服务未配置，请联系系统管理员',
  EMPLOYEE_ADMIN_INPUT_INVALID: '员工资料格式无效',
  EMPLOYEE_ADMIN_RESPONSE_INVALID: '人员管理服务响应无效，请稍后重试',
  EMPLOYEE_ADMIN_SERVICE_UNAVAILABLE: '人员管理服务暂不可用，请稍后重试',
  PROVISION_INPUT_INVALID: '员工资料格式无效',
  EMPLOYEE_ADMIN_FAILED: '员工管理操作失败，请稍后重试',
  PROVISION_FAILED: '员工创建失败，请稍后重试',
  PROVISION_AUTH_FAILED: '员工创建失败，请稍后重试',
  PROVISION_PROFILE_FAILED: '员工创建失败，请稍后重试',
  PROVISION_IN_PROGRESS: '员工正在创建，请稍后重试',
  PROVISION_STATE_CONFLICT: '员工创建状态冲突，请刷新后重试',
  PROVISION_RETRY_REQUIRED: '员工创建尚未完成，请使用同一请求重试',
  PROVISION_COMPENSATION_PENDING: '员工创建尚未完成，请稍后使用同一请求重试',
  PERSONNEL_ADMIN_REQUIRED: '没有人员管理权限',
  SENSITIVE_PERMISSION_REQUIRED: '没有修改敏感员工资料的权限',
  EMPLOYEE_TARGET_INVALID: '该员工账号不可操作',
  ACCOUNT_STATUS_UPDATE_FAILED: '账号状态更新失败，请刷新后重试',
  ACCOUNT_SESSION_REVOKE_FAILED: '账号已停用，但会话撤销失败，请联系系统管理员',
  ACCOUNT_AUTH_SYNC_FAILED: '账号认证状态同步失败，请刷新后确认当前状态',
  PASSWORD_RESET_FAILED: '临时密码生成失败，请稍后重试',
  PASSWORD_RESET_IN_PROGRESS: '临时密码正在生成，请稍后重试',
  PASSWORD_RESET_RECENTLY_COMPLETED: '临时密码刚刚生成，请稍后再试',
  AUTH_INVALID: '登录状态无效，请重新登录',
  AUTH_TOKEN_INVALID: '登录状态无效，请重新登录',
  EMPLOYEE_NOT_LINKED: '员工账号未关联，请重新登录',
  EMPLOYEE_INACTIVE: '当前员工状态不可访问，请重新登录',
  ACCOUNT_DISABLED: '当前账号已停用，请重新登录',
  PASSWORD_CHANGE_REQUIRED: '请先重新登录并修改临时密码',
  AUTH_SERVICE_UNAVAILABLE: '认证服务暂不可用，请稍后重试',
})

const AUTH_INVALID_CODES = new Set([
  'AUTH_INVALID',
  'AUTH_TOKEN_INVALID',
  'EMPLOYEE_NOT_LINKED',
  'EMPLOYEE_INACTIVE',
  'ACCOUNT_DISABLED',
  'PASSWORD_CHANGE_REQUIRED',
])

export class EmployeeAdminError extends Error {
  constructor(code, { status = 0, authInvalid = false } = {}) {
    super(
      SAFE_ERROR_MESSAGES[code] ||
        SAFE_ERROR_MESSAGES.EMPLOYEE_ADMIN_SERVICE_UNAVAILABLE,
    )
    this.name = 'EmployeeAdminError'
    this.code = SAFE_ERROR_MESSAGES[code]
      ? code
      : 'EMPLOYEE_ADMIN_SERVICE_UNAVAILABLE'
    this.status = Number.isInteger(status) ? status : 0
    this.authInvalid = authInvalid === true
  }
}

function adminError(code, options) {
  return new EmployeeAdminError(code, options)
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(value, expectedKeys) {
  if (!isPlainObject(value)) return false
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  )
}

function assertConfigured(client, configured) {
  if (!configured || !client) throw adminError('CONFIGURATION_ERROR')
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return (
    !Number.isNaN(parsed.valueOf()) &&
    parsed.toISOString().slice(0, 10) === value
  )
}

function normalizeNullableString(value, maximum = 500) {
  if (value === null) return null
  if (typeof value !== 'string') throw adminError('EMPLOYEE_ADMIN_INPUT_INVALID')
  const normalized = value.trim()
  if (!normalized) return null
  if (normalized.length > maximum) {
    throw adminError('EMPLOYEE_ADMIN_INPUT_INVALID')
  }
  return normalized
}

function normalizeProfileField(key, value) {
  if (key === 'attendanceRequired') {
    if (typeof value !== 'boolean') {
      throw adminError('EMPLOYEE_ADMIN_INPUT_INVALID')
    }
    return value
  }
  if (key === 'name') {
    if (typeof value !== 'string') throw adminError('EMPLOYEE_ADMIN_INPUT_INVALID')
    const name = value.trim()
    if (!name || name.length > 100) throw adminError('EMPLOYEE_ADMIN_INPUT_INVALID')
    return name
  }
  if (key === 'department') {
    if (!DEPARTMENT_OPTIONS.includes(value)) {
      throw adminError('EMPLOYEE_ADMIN_INPUT_INVALID')
    }
    return value
  }
  if (key === 'position') {
    if (!POSITION_OPTIONS.includes(value)) {
      throw adminError('EMPLOYEE_ADMIN_INPUT_INVALID')
    }
    return value
  }
  if (key === 'employmentStatus') {
    if (!EMPLOYMENT_STATUSES.has(value)) {
      throw adminError('EMPLOYEE_ADMIN_INPUT_INVALID')
    }
    return value
  }
  if (key === 'gender') {
    if (value === null || value === '') return null
    if (!GENDER_OPTIONS.has(value)) throw adminError('EMPLOYEE_ADMIN_INPUT_INVALID')
    return value
  }
  if (key === 'level') {
    if (value === null || value === '') return null
    if (!LEVEL_OPTIONS.has(value)) throw adminError('EMPLOYEE_ADMIN_INPUT_INVALID')
    return value
  }
  if (DATE_FIELDS.has(key)) {
    if (value === null || (typeof value === 'string' && !value.trim())) return null
    if (typeof value !== 'string' || !validDate(value.trim())) {
      throw adminError('EMPLOYEE_ADMIN_INPUT_INVALID')
    }
    return value.trim()
  }
  if (NUMBER_FIELDS.has(key)) {
    if (value === null || (typeof value === 'string' && !value.trim())) return null
    if (
      !['number', 'string'].includes(typeof value) ||
      typeof value === 'boolean'
    ) {
      throw adminError('EMPLOYEE_ADMIN_INPUT_INVALID')
    }
    const number = Number(value)
    if (!Number.isFinite(number) || number < 0 || number > 1e12) {
      throw adminError('EMPLOYEE_ADMIN_INPUT_INVALID')
    }
    return number
  }
  return normalizeNullableString(
    value,
    ['remark', 'salaryRemark'].includes(key) ? 2000 : 500,
  )
}

function normalizeProfile(profile, { partial = false } = {}) {
  if (!isPlainObject(profile)) throw adminError('EMPLOYEE_ADMIN_INPUT_INVALID')
  const keys = Object.keys(profile)
  if (
    (partial && keys.length === 0) ||
    keys.some((key) => !PROFILE_FIELD_SET.has(key))
  ) {
    throw adminError('EMPLOYEE_ADMIN_INPUT_INVALID')
  }
  if (
    !partial &&
    ['name', 'department', 'position'].some((key) => !Object.hasOwn(profile, key))
  ) {
    throw adminError('EMPLOYEE_ADMIN_INPUT_INVALID')
  }
  return Object.fromEntries(
    keys.map((key) => [key, normalizeProfileField(key, profile[key])]),
  )
}

function validNullableString(value) {
  return value === null || typeof value === 'string'
}

function validNullableDate(value) {
  return value === null || (typeof value === 'string' && validDate(value))
}

function mapDirectoryRow(value) {
  if (
    !hasExactKeys(value, DIRECTORY_FIELDS) ||
    !UUID_PATTERN.test(value.id) ||
    !EMPLOYEE_NUMBER_PATTERN.test(value.employeeNumber) ||
    typeof value.name !== 'string' ||
    !value.name ||
    !DEPARTMENT_OPTIONS.includes(value.department) ||
    !POSITION_OPTIONS.includes(value.position) ||
    !EMPLOYMENT_STATUSES.has(value.employmentStatus) ||
    !ACCOUNT_STATUSES.has(value.accountStatus) ||
    typeof value.attendanceRequired !== 'boolean'
  ) {
    throw adminError('EMPLOYEE_ADMIN_RESPONSE_INVALID')
  }
  return Object.fromEntries(DIRECTORY_FIELDS.map((key) => [key, value[key]]))
}

function mapEmployeeSummary(value) {
  if (!hasExactKeys(value, EMPLOYEE_SUMMARY_FIELDS)) {
    throw adminError('EMPLOYEE_ADMIN_RESPONSE_INVALID')
  }
  const directory = mapDirectoryRow(
    Object.fromEntries(DIRECTORY_FIELDS.map((key) => [key, value[key]])),
  )
  if (typeof value.mustChangePassword !== 'boolean') {
    throw adminError('EMPLOYEE_ADMIN_RESPONSE_INVALID')
  }
  return { ...directory, mustChangePassword: value.mustChangePassword }
}

function mapProvisionEmployeeSummary(value) {
  if (hasExactKeys(value, EMPLOYEE_SUMMARY_FIELDS)) {
    return mapEmployeeSummary(value)
  }
  if (!hasExactKeys(value, PROVISION_EMPLOYEE_SUMMARY_FIELDS)) {
    throw adminError('EMPLOYEE_ADMIN_RESPONSE_INVALID')
  }
  return mapEmployeeSummary({ ...value, attendanceRequired: true })
}

function bindEmployeeToTarget(employee, expectedEmployeeId) {
  if (employee.id.toLowerCase() !== expectedEmployeeId) {
    throw adminError('EMPLOYEE_ADMIN_RESPONSE_INVALID')
  }
  return employee
}

function validateDetailGroup(value, fields) {
  const present = fields.filter((field) => Object.hasOwn(value, field))
  return present.length === 0 || present.length === fields.length
}

function mapEmployeeDetail(value) {
  const identityPresent = DETAIL_IDENTITY_FIELDS.some((key) => Object.hasOwn(value, key))
  const salaryPresent = DETAIL_SALARY_FIELDS.some((key) => Object.hasOwn(value, key))
  const expectedFields = [
    ...DETAIL_BASE_FIELDS,
    ...(identityPresent ? DETAIL_IDENTITY_FIELDS : []),
    ...(salaryPresent ? DETAIL_SALARY_FIELDS : []),
  ]
  if (
    !hasExactKeys(value, expectedFields) ||
    !validateDetailGroup(value, DETAIL_IDENTITY_FIELDS) ||
    !validateDetailGroup(value, DETAIL_SALARY_FIELDS)
  ) {
    throw adminError('EMPLOYEE_ADMIN_RESPONSE_INVALID')
  }

  const summary = mapEmployeeSummary(
    Object.fromEntries(EMPLOYEE_SUMMARY_FIELDS.map((key) => [key, value[key]])),
  )
  if (
    !validNullableString(value.legacyEmployeeId) ||
    !validNullableDate(value.hireDate) ||
    !validNullableDate(value.resignDate) ||
    !(value.level === null || LEVEL_OPTIONS.has(value.level)) ||
    !validNullableString(value.phone) ||
    !validNullableString(value.remark) ||
    typeof value.createdAt !== 'string' ||
    !value.createdAt ||
    typeof value.updatedAt !== 'string' ||
    !value.updatedAt
  ) {
    throw adminError('EMPLOYEE_ADMIN_RESPONSE_INVALID')
  }

  if (identityPresent) {
    if (
      !(value.gender === null || GENDER_OPTIONS.has(value.gender)) ||
      !validNullableDate(value.birthDate) ||
      !validNullableDate(value.visaExpireDate) ||
      DETAIL_IDENTITY_FIELDS.filter(
        (key) => !['gender', 'birthDate', 'visaExpireDate'].includes(key),
      ).some((key) => !validNullableString(value[key]))
    ) {
      throw adminError('EMPLOYEE_ADMIN_RESPONSE_INVALID')
    }
  }
  if (
    salaryPresent &&
    (['baseSalary', 'dailySalary', 'hourlyWage'].some(
      (key) =>
        !(
          value[key] === null ||
          (typeof value[key] === 'number' &&
            Number.isFinite(value[key]) &&
            value[key] >= 0)
        ),
    ) ||
      !validNullableString(value.salaryRemark))
  ) {
    throw adminError('EMPLOYEE_ADMIN_RESPONSE_INVALID')
  }

  return Object.fromEntries(expectedFields.map((key) => [key, value[key]]))
}

function validCredential(value) {
  return typeof value === 'string' && /^[0-9]{6}$/u.test(value)
}

function parseProvisionResponse(value) {
  if (
    !isPlainObject(value) ||
    ![1, 2].includes(Object.keys(value).length) ||
    !Object.hasOwn(value, 'employee')
  ) {
    throw adminError('EMPLOYEE_ADMIN_RESPONSE_INVALID')
  }
  const employee = mapProvisionEmployeeSummary(value.employee)
  if (Object.keys(value).length === 1) return { employee }
  if (!hasExactKeys(value, ['employee', 'initialPassword']) || !validCredential(value.initialPassword)) {
    throw adminError('EMPLOYEE_ADMIN_RESPONSE_INVALID')
  }
  return { employee, initialPassword: value.initialPassword }
}

function parseEmployeeResponse(value, expectedEmployeeId) {
  if (!hasExactKeys(value, ['employee'])) {
    throw adminError('EMPLOYEE_ADMIN_RESPONSE_INVALID')
  }
  return {
    employee: bindEmployeeToTarget(
      mapEmployeeSummary(value.employee),
      expectedEmployeeId,
    ),
  }
}

function parseResetResponse(value, expectedEmployeeId) {
  if (
    !hasExactKeys(value, ['employee', 'temporaryPassword']) ||
    !validCredential(value.temporaryPassword)
  ) {
    throw adminError('EMPLOYEE_ADMIN_RESPONSE_INVALID')
  }
  return {
    employee: bindEmployeeToTarget(
      mapEmployeeSummary(value.employee),
      expectedEmployeeId,
    ),
    initialPassword: value.temporaryPassword,
  }
}

async function parseEdgeError(error) {
  let response
  let body
  try {
    if (!(error?.context instanceof Response)) {
      throw new TypeError('missing response')
    }
    response = error.context.clone()
    body = await response.json()
  } catch {
    throw adminError('EMPLOYEE_ADMIN_SERVICE_UNAVAILABLE')
  }
  const code = body?.error?.code
  if (typeof code !== 'string' || !SAFE_ERROR_MESSAGES[code]) {
    throw adminError('EMPLOYEE_ADMIN_SERVICE_UNAVAILABLE')
  }
  throw adminError(code, {
    status: response.status,
    authInvalid: AUTH_INVALID_CODES.has(code),
  })
}

function assertExactInput(value, keys) {
  if (!hasExactKeys(value, keys)) {
    throw adminError('EMPLOYEE_ADMIN_INPUT_INVALID')
  }
}

function normalizeEmployeeId(employeeId) {
  if (typeof employeeId !== 'string' || !UUID_PATTERN.test(employeeId)) {
    throw adminError('EMPLOYEE_ADMIN_INPUT_INVALID')
  }
  return employeeId.toLowerCase()
}

export function createEmployeeAdminService(
  client,
  { configured = Boolean(client) } = {},
) {
  async function callRpc(name, args) {
    let result
    try {
      result = args === undefined ? await client.rpc(name) : await client.rpc(name, args)
    } catch {
      throw adminError('EMPLOYEE_ADMIN_SERVICE_UNAVAILABLE')
    }
    if (result?.error) throw adminError('EMPLOYEE_ADMIN_SERVICE_UNAVAILABLE')
    return result?.data
  }

  async function invoke(name, body) {
    let result
    try {
      result = await client.functions.invoke(name, { body })
    } catch {
      throw adminError('EMPLOYEE_ADMIN_SERVICE_UNAVAILABLE')
    }
    if (result?.error) await parseEdgeError(result.error)
    return result?.data
  }

  async function listEmployeeDirectory() {
    assertConfigured(client, configured)
    const data = await callRpc('employee_directory')
    if (!Array.isArray(data)) throw adminError('EMPLOYEE_ADMIN_RESPONSE_INVALID')
    return data
      .map(mapDirectoryRow)
      .filter((employee) => employee.employeeNumber !== 'SW-000')
  }

  async function getEmployeeProfileDetail(employeeId) {
    assertConfigured(client, configured)
    const normalizedId = normalizeEmployeeId(employeeId)
    const data = await callRpc('employee_profile_detail', {
      p_employee_id: normalizedId,
    })
    return data === null
      ? null
      : bindEmployeeToTarget(mapEmployeeDetail(data), normalizedId)
  }

  async function provisionEmployee(input) {
    assertConfigured(client, configured)
    assertExactInput(input, ['requestId', 'profile'])
    if (typeof input.requestId !== 'string' || !UUID_V4_PATTERN.test(input.requestId)) {
      throw adminError('EMPLOYEE_ADMIN_INPUT_INVALID')
    }
    const body = {
      requestId: input.requestId.toLowerCase(),
      profile: normalizeProfile(input.profile),
    }
    return parseProvisionResponse(await invoke('employee-provision', body))
  }

  async function updateProfile(input) {
    assertConfigured(client, configured)
    assertExactInput(input, ['employeeId', 'patch'])
    const employeeId = normalizeEmployeeId(input.employeeId)
    const body = {
      operation: 'update_profile',
      employeeId,
      patch: normalizeProfile(input.patch, { partial: true }),
    }
    return parseEmployeeResponse(await invoke('employee-admin', body), employeeId)
  }

  async function setAccountStatus(input) {
    assertConfigured(client, configured)
    assertExactInput(input, ['employeeId', 'accountStatus'])
    if (!ACCOUNT_STATUSES.has(input.accountStatus)) {
      throw adminError('EMPLOYEE_ADMIN_INPUT_INVALID')
    }
    const employeeId = normalizeEmployeeId(input.employeeId)
    const body = {
      operation: 'set_account_status',
      employeeId,
      accountStatus: input.accountStatus,
    }
    return parseEmployeeResponse(await invoke('employee-admin', body), employeeId)
  }

  async function resetTemporaryPassword(input) {
    assertConfigured(client, configured)
    assertExactInput(input, ['employeeId'])
    const employeeId = normalizeEmployeeId(input.employeeId)
    const body = {
      operation: 'reset_temporary_password',
      employeeId,
    }
    return parseResetResponse(await invoke('employee-admin', body), employeeId)
  }

  return Object.freeze({
    listEmployeeDirectory,
    getEmployeeProfileDetail,
    provisionEmployee,
    updateProfile,
    setAccountStatus,
    resetTemporaryPassword,
  })
}

export const employeeAdminService = createEmployeeAdminService(supabase, {
  configured: isSupabaseConfigured,
})

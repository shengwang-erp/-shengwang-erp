import {
  DEPARTMENT_OPTIONS,
  POSITION_OPTIONS,
} from '../auth/employeeAuthDomain.js'
import {
  isTemplatePermissionKey,
  PERMISSION_CATALOG,
  templateContainsForbiddenProjectFinancialGrant,
} from '../auth/permissionCatalog.js'
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js'

const SAFE_ERROR_MESSAGES = Object.freeze({
  CONFIGURATION_ERROR: '权限模板服务未配置',
  PERMISSION_TEMPLATE_INPUT_INVALID: '权限模板请求格式无效',
  AUTH_TOKEN_INVALID: '登录凭证无效',
  AUTH_INVALID: '登录状态无效，请重新登录',
  EMPLOYEE_NOT_LINKED: '员工账号未关联',
  ACCOUNT_DISABLED: '账号已停用',
  EMPLOYEE_INACTIVE: '当前员工状态不可访问',
  PASSWORD_CHANGE_REQUIRED: '请先修改临时密码',
  PERSONNEL_ADMIN_REQUIRED: '没有人员管理权限',
  AUTH_SERVICE_UNAVAILABLE: '认证服务暂不可用',
  PERMISSION_TEMPLATES_FAILED: '权限模板服务暂不可用',
  PERMISSION_TEMPLATE_RESPONSE_INVALID: '权限模板服务响应无效',
  PERMISSION_TEMPLATES_UNAVAILABLE: '权限模板服务暂不可用',
})

export class PermissionTemplateError extends Error {
  constructor(code) {
    super(
      SAFE_ERROR_MESSAGES[code] ??
        SAFE_ERROR_MESSAGES.PERMISSION_TEMPLATES_UNAVAILABLE,
    )
    this.name = 'PermissionTemplateError'
    this.code = SAFE_ERROR_MESSAGES[code]
      ? code
      : 'PERMISSION_TEMPLATES_UNAVAILABLE'
  }
}

function templateError(code) {
  return new PermissionTemplateError(code)
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactFields(value, fields) {
  const keys = Object.keys(value).sort()
  return keys.length === fields.length &&
    keys.every((key, index) => key === fields[index])
}

function validatePermissionList(value) {
  if (
    !Array.isArray(value) ||
    value.length > PERMISSION_CATALOG.length ||
    value.some((permission) => !isTemplatePermissionKey(permission)) ||
    new Set(value).size !== value.length
  ) {
    throw templateError('PERMISSION_TEMPLATE_RESPONSE_INVALID')
  }
  const sorted = [...value].sort()
  if (sorted.some((permission, index) => permission !== value[index])) {
    throw templateError('PERMISSION_TEMPLATE_RESPONSE_INVALID')
  }
  return sorted
}

function validateSubjectMap(value, fixedOptions) {
  if (!isPlainObject(value)) {
    throw templateError('PERMISSION_TEMPLATE_RESPONSE_INVALID')
  }
  const keys = Object.keys(value).sort()
  const expectedKeys = [...fixedOptions].sort()
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw templateError('PERMISSION_TEMPLATE_RESPONSE_INVALID')
  }
  return Object.fromEntries(
    fixedOptions.map((
      subject,
    ) => [subject, validatePermissionList(value[subject])]),
  )
}

export function validatePermissionTemplateSnapshot(value) {
  if (
    !isPlainObject(value) ||
    !hasExactFields(value, ['departments', 'positions'])
  ) {
    throw templateError('PERMISSION_TEMPLATE_RESPONSE_INVALID')
  }
  return {
    departments: validateSubjectMap(value.departments, DEPARTMENT_OPTIONS),
    positions: validateSubjectMap(value.positions, POSITION_OPTIONS),
  }
}

function validateReplacementInput(value) {
  if (
    !isPlainObject(value) ||
    !hasExactFields(value, ['permissionKeys', 'subjectCode', 'subjectType'])
  ) {
    throw templateError('PERMISSION_TEMPLATE_INPUT_INVALID')
  }
  const fixedSubjects = value.subjectType === 'department'
    ? DEPARTMENT_OPTIONS
    : value.subjectType === 'position'
    ? POSITION_OPTIONS
    : null
  if (
    !fixedSubjects?.includes(value.subjectCode) ||
    !Array.isArray(value.permissionKeys) ||
    value.permissionKeys.length > PERMISSION_CATALOG.length ||
    value.permissionKeys.some((permission) =>
      !isTemplatePermissionKey(permission)
    ) ||
    new Set(value.permissionKeys).size !== value.permissionKeys.length ||
    templateContainsForbiddenProjectFinancialGrant(
      value.subjectType,
      value.subjectCode,
      value.permissionKeys,
    )
  ) {
    throw templateError('PERMISSION_TEMPLATE_INPUT_INVALID')
  }
  return {
    subjectType: value.subjectType,
    subjectCode: value.subjectCode,
    permissionKeys: [...value.permissionKeys].sort(),
  }
}

async function parseEdgeError(error) {
  let payload = null
  try {
    if (error?.context instanceof Response) {
      payload = await error.context.clone().json()
    }
  } catch {
    payload = null
  }
  const code = payload?.error?.code
  return typeof code === 'string' && SAFE_ERROR_MESSAGES[code]
    ? templateError(code)
    : templateError('PERMISSION_TEMPLATES_UNAVAILABLE')
}

export function createPermissionTemplateService(
  client,
  { configured = Boolean(client) } = {},
) {
  function assertConfigured() {
    if (!configured || !client?.functions?.invoke) {
      throw templateError('CONFIGURATION_ERROR')
    }
  }

  async function invoke(body) {
    assertConfigured()
    let result
    try {
      result = await client.functions.invoke('permission-templates', { body })
    } catch {
      throw templateError('PERMISSION_TEMPLATES_UNAVAILABLE')
    }
    if (result?.error) throw await parseEdgeError(result.error)
    return validatePermissionTemplateSnapshot(result?.data)
  }

  async function readPermissionTemplates() {
    return await invoke({ operation: 'read' })
  }

  async function replacePermissionTemplate(value) {
    const input = validateReplacementInput(value)
    return await invoke({ operation: 'replace', ...input })
  }

  return Object.freeze({
    readPermissionTemplates,
    replacePermissionTemplate,
  })
}

export const permissionTemplateService = createPermissionTemplateService(
  supabase,
  {
    configured: isSupabaseConfigured,
  },
)

export const readPermissionTemplates = (...args) =>
  permissionTemplateService.readPermissionTemplates(...args)
export const replacePermissionTemplate = (...args) =>
  permissionTemplateService.replacePermissionTemplate(...args)

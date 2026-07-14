import { createAdminClient as createDefaultAdminClient } from '../_shared/clients.ts'
import {
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
  isTemplatePermissionKey,
  PERMISSION_CATALOG,
  templateContainsForbiddenProjectFinancialGrant,
} from '../../../src/auth/permissionCatalog.js'

const MAX_REQUEST_BYTES = 16 * 1024
const READ_FIELDS = Object.freeze(['operation'])
const REPLACE_FIELDS = Object.freeze([
  'operation',
  'permissionKeys',
  'subjectCode',
  'subjectType',
])

function inputError() {
  return new EdgeSecurityError(
    'PERMISSION_TEMPLATE_INPUT_INVALID',
    '权限模板请求格式无效',
    400,
  )
}

function serviceError() {
  return new EdgeSecurityError(
    'PERMISSION_TEMPLATES_FAILED',
    '权限模板服务暂不可用',
    503,
  )
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

function fixedSubjectOptions(subjectType) {
  if (subjectType === 'department') return DEPARTMENT_OPTIONS
  if (subjectType === 'position') return POSITION_OPTIONS
  return null
}

function validateReplacement(value) {
  if (!isPlainObject(value) || !hasExactFields(value, REPLACE_FIELDS)) {
    throw inputError()
  }
  const subjects = fixedSubjectOptions(value.subjectType)
  if (
    !subjects?.includes(value.subjectCode) ||
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
    throw inputError()
  }
  return {
    operation: 'replace',
    subjectType: value.subjectType,
    subjectCode: value.subjectCode,
    permissionKeys: [...value.permissionKeys].sort(),
  }
}

async function readInput(request) {
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
  if (!isPlainObject(body)) throw inputError()
  if (body.operation === 'read' && hasExactFields(body, READ_FIELDS)) {
    return { operation: 'read' }
  }
  if (body.operation === 'replace') return validateReplacement(body)
  throw inputError()
}

function validatePermissionList(value) {
  if (
    !Array.isArray(value) ||
    value.length > PERMISSION_CATALOG.length ||
    value.some((permission) => !isTemplatePermissionKey(permission)) ||
    new Set(value).size !== value.length
  ) {
    throw serviceError()
  }
  const sorted = [...value].sort()
  if (sorted.some((permission, index) => permission !== value[index])) {
    throw serviceError()
  }
  return sorted
}

function validateSubjectMap(value, fixedOptions) {
  if (!isPlainObject(value)) throw serviceError()
  const actualKeys = Object.keys(value).sort()
  const expectedKeys = [...fixedOptions].sort()
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw serviceError()
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
    throw serviceError()
  }
  return {
    departments: validateSubjectMap(value.departments, DEPARTMENT_OPTIONS),
    positions: validateSubjectMap(value.positions, POSITION_OPTIONS),
  }
}

async function readTemplatesRpc(client, { actorAuthUserId }) {
  const result = await client.rpc('read_permission_templates_admin', {
    p_actor_auth_user_id: actorAuthUserId,
  })
  if (result?.error) throw serviceError()
  return result?.data
}

async function replaceTemplateRpc(client, input) {
  const result = await client.rpc('replace_permission_template_admin', {
    p_subject_type: input.subjectType,
    p_subject_code: input.subjectCode,
    p_permission_keys: input.permissionKeys,
    p_actor_auth_user_id: input.actorAuthUserId,
  })
  if (result?.error) throw serviceError()
  return result?.data
}

export function createPermissionTemplatesHandler(dependencies = {}) {
  const operations = {
    requirePersonnelAdministrator: dependencies.requirePersonnelAdministrator ??
      requireDefaultPersonnelAdministrator,
    createAdminClient: dependencies.createAdminClient ??
      createDefaultAdminClient,
    readTemplates: dependencies.readTemplates ?? readTemplatesRpc,
    replaceTemplate: dependencies.replaceTemplate ?? replaceTemplateRpc,
  }

  return async function permissionTemplatesHandler(request) {
    try {
      const input = await readInput(request)
      const actor = await operations.requirePersonnelAdministrator(request)
      if (typeof actor?.authUserId !== 'string' || !actor.authUserId) {
        throw serviceError()
      }
      const adminClient = await operations.createAdminClient()
      const snapshot = input.operation === 'read'
        ? await operations.readTemplates(adminClient, {
          actorAuthUserId: actor.authUserId,
        })
        : await operations.replaceTemplate(adminClient, {
          actorAuthUserId: actor.authUserId,
          subjectType: input.subjectType,
          subjectCode: input.subjectCode,
          permissionKeys: input.permissionKeys,
        })
      return jsonResponse(validatePermissionTemplateSnapshot(snapshot), 200)
    } catch (error) {
      return safeErrorResponse(error)
    }
  }
}

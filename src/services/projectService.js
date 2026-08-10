import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js'

export class ProjectServiceError extends Error {
  constructor(code, message = '项目数据操作失败') {
    super(message)
    this.name = 'ProjectServiceError'
    this.code = code
  }
}

function normalizeError(error) {
  const status = Number(error?.status)
  const code = String(error?.code || '').toUpperCase()
  if (status === 401 || ['401', 'PGRST301', 'JWT_EXPIRED'].includes(code)) {
    return new ProjectServiceError('authInvalid', '登录状态无效，请重新登录')
  }
  return new ProjectServiceError('operationFailed')
}

function validateProject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProjectServiceError('invalidResponse')
  }
  const project = value.project || value
  if (typeof project !== 'object' || Array.isArray(project)) {
    throw new ProjectServiceError('invalidResponse')
  }
  return { ...project }
}

const PROJECT_REFERENCE_KEYS = Object.freeze([
  'projectId', 'projectName', 'status', 'address',
])

function validateProjectReference(value) {
  try {
    if (
      value === null ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    ) throw new ProjectServiceError('invalidResponse')

    const descriptors = Object.getOwnPropertyDescriptors(value)
    if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string')) {
      throw new ProjectServiceError('invalidResponse')
    }
    const keys = Object.keys(descriptors)
    if (
      keys.length !== PROJECT_REFERENCE_KEYS.length ||
      keys.some((key) => !PROJECT_REFERENCE_KEYS.includes(key)) ||
      PROJECT_REFERENCE_KEYS.some((key) => {
        const descriptor = descriptors[key]
        return !descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string'
      }) ||
      descriptors.projectId.value.trim() === '' ||
      descriptors.projectName.value.trim() === ''
    ) throw new ProjectServiceError('invalidResponse')

    return Object.fromEntries(PROJECT_REFERENCE_KEYS.map(
      (key) => [key, descriptors[key].value],
    ))
  } catch (error) {
    if (error instanceof ProjectServiceError) throw error
    throw new ProjectServiceError('invalidResponse')
  }
}

export function createProjectService(client = supabase, { configured = isSupabaseConfigured } = {}) {
  function ensureConfigured() {
    if (!configured || !client || typeof client.rpc !== 'function') {
      throw new ProjectServiceError('notConfigured', '云端数据服务未配置')
    }
  }

  async function call(name, args) {
    ensureConfigured()
    let result
    try {
      result = await client.rpc(name, args)
    } catch (error) {
      throw normalizeError(error)
    }
    if (result?.error) throw normalizeError(result.error)
    return result?.data
  }

  return {
    async listProjects() {
      const data = await call('list_projects_secure', {})
      if (!Array.isArray(data)) throw new ProjectServiceError('invalidResponse')
      return data.map(validateProject)
    },
    async listProjectReferences() {
      const data = await call('list_project_references_secure', {})
      if (!Array.isArray(data)) throw new ProjectServiceError('invalidResponse')
      return data.map(validateProjectReference)
    },
    async createProject(payload) {
      return validateProject(await call('create_project_secure', { p_payload: payload }))
    },
    async updateProject(projectId, patch) {
      return validateProject(await call('update_project_secure', { p_project_id: projectId, p_patch: patch }))
    },
    async softDeleteProject(projectId) {
      const data = await call('soft_delete_project_secure', { p_project_id: projectId })
      if (typeof data !== 'string' || !data) throw new ProjectServiceError('invalidResponse')
      return data
    },
  }
}

export const projectService = createProjectService()

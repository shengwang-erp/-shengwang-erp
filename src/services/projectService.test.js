import assert from 'node:assert/strict'
import test from 'node:test'
import { createProjectService, ProjectServiceError } from './projectService.js'

test('project writes use only secure RPCs', async () => {
  const calls = []
  const service = createProjectService({ rpc: async (name, args) => {
    calls.push([name, args])
    return { data: name === 'soft_delete_project_secure' ? 'P001' : { projectId: 'P001' }, error: null }
  } }, { configured: true })
  await service.createProject({ projectName: '安全项目' })
  await service.updateProject('P001', { remark: '更新' })
  await service.softDeleteProject('P001')
  assert.deepEqual(calls.map(([name]) => name), ['create_project_secure', 'update_project_secure', 'soft_delete_project_secure'])
})

test('unconfigured access fails closed without generic adapter', async () => {
  const service = createProjectService({ from: () => { throw new Error('generic') } }, { configured: false })
  await assert.rejects(() => service.listProjects(), (error) => error instanceof ProjectServiceError && error.code === 'notConfigured')
})

test('auth failures map to authInvalid', async () => {
  const service = createProjectService({ rpc: async () => ({ data: null, error: { status: 401 } }) }, { configured: true })
  await assert.rejects(() => service.listProjects(), (error) => error.code === 'authInvalid')
})

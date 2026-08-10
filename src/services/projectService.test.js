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

test('project relation readers use the narrow reference RPC', async () => {
  const calls = []
  const service = createProjectService({ rpc: async (name, args) => {
    calls.push([name, args])
    return {
      data: [{
        projectId: 'P001', projectName: '安全项目', status: '进行中', address: '东京',
      }],
      error: null,
    }
  } }, { configured: true })

  assert.deepEqual(await service.listProjectReferences(), [{
    projectId: 'P001', projectName: '安全项目', status: '进行中', address: '东京',
  }])
  assert.deepEqual(calls, [['list_project_references_secure', {}]])
})

test('project reference response rejects extra or malformed project data', async () => {
  const accessorRow = {
    projectId: 'P001', status: '进行中', address: '',
  }
  Object.defineProperty(accessorRow, 'projectName', {
    enumerable: true,
    get() { return '不可信访问器项目' },
  })
  const trappedRow = new Proxy({}, {
    getPrototypeOf() { throw new Error('supplier trap') },
  })
  for (const row of [
    { projectId: 'P001', projectName: '项目', status: '进行中', address: '', contractAmount: 1 },
    { projectId: '', projectName: '项目', status: '进行中', address: '' },
    { projectId: 'P001', projectName: '项目', status: 1, address: '' },
    accessorRow,
    trappedRow,
  ]) {
    const service = createProjectService({
      rpc: async () => ({ data: [row], error: null }),
    }, { configured: true })
    await assert.rejects(
      () => service.listProjectReferences(),
      (error) => error instanceof ProjectServiceError && error.code === 'invalidResponse',
    )
  }
})

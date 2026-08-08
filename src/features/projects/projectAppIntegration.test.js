import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appSource = await readFile(new URL('../../App.jsx', import.meta.url), 'utf8')
const projectDirectoryStart = appSource.indexOf('const refreshProjectEmployeeDirectory')
const projectDirectoryEnd = appSource.indexOf('const personnelProtectedState', projectDirectoryStart)
const projectDirectorySource = appSource.slice(projectDirectoryStart, projectDirectoryEnd)

test('App renders the extracted project page instead of the legacy inline form', () => {
  assert.match(appSource, /import ProjectPage from ['"]\.\/features\/projects\/ProjectPage['"]/)
  assert.doesNotMatch(appSource, /function ProjectPage\s*\(/)

  for (const prop of [
    'projects', 'projectRevenueSnapshots', 'currentUser', 'employeeDirectory',
    'directoryState', 'onRetryDirectory', 'onCreateProject', 'onUpdateProject',
    'onDeleteProject', 'onOpenContractRevenue', 'onBack',
  ]) assert.match(appSource, new RegExp(`${prop}=`))
})

test('App owns a project-only canonical employee directory with retry state', () => {
  assert.match(appSource, /projectEmployeeDirectory/)
  assert.match(appSource, /projectDirectoryState/)
  assert.match(appSource, /refreshProjectEmployeeDirectory/)
  assert.match(appSource, /currentView !== ['"]projects['"]/)
  assert.match(appSource, /employeeAdminService\.listEmployeeDirectory\(\)/)
  assert.ok(projectDirectoryStart >= 0 && projectDirectoryEnd > projectDirectoryStart)
  assert.match(projectDirectorySource, /error\?\.authInvalid[\s\S]*?onLogout\(\)/)
})

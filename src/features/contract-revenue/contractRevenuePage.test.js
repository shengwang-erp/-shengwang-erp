import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function readSource(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8').catch(() => '')
}

const [appSource, pageSource, sectionSource, projectPageSource] = await Promise.all([
  readSource('../../App.jsx'),
  readSource('./ContractRevenuePage.jsx'),
  readSource('./OriginalContractSection.jsx'),
  readSource('../projects/ProjectPage.jsx'),
])

test('contract revenue page and original contract section are independent components', () => {
  assert.match(pageSource, /function ContractRevenuePage/)
  assert.match(pageSource, /<OriginalContractSection/)
  assert.match(sectionSource, /function OriginalContractSection/)
  assert.match(appSource, /import ContractRevenuePage from/)
  assert.match(appSource, /<ContractRevenuePage/)
})

test('App routes from project details to contract revenue while retaining raw project callbacks', () => {
  assert.match(appSource, /authorizedView === 'contractRevenue'/)
  assert.match(appSource, /onOpenContractRevenue=\{openContractRevenue\}/)
  assert.match(appSource, /onProjectChange=\{handleContractRevenueProjectChange\}/)
  assert.match(appSource, /projectService\.createProject/)
  assert.match(projectPageSource, /onOpenContractRevenue\(project\.projectId\)/)
  assert.match(projectPageSource, />\s*合同收入\s*</)
})

test('project base editor no longer contains direct contract or receipt amount inputs', () => {
  assert.match(appSource, /import ProjectPage from/)
  assert.match(projectPageSource, /export function ProjectPage/)
  assert.doesNotMatch(projectPageSource, /label="合同金额（日元）"/)
  assert.doesNotMatch(projectPageSource, /label="已收款金额（日元）"/)
  assert.doesNotMatch(projectPageSource, /form\.contractAmount/)
  assert.doesNotMatch(projectPageSource, /form\.paidAmount/)
})

test('original contract UI exposes draft and confirmation actions but keeps legacy projects read-only', () => {
  assert.match(sectionSource, /需要迁移后复核/)
  assert.match(sectionSource, /保存草稿/)
  assert.match(sectionSource, /会计确认/)
  assert.match(sectionSource, /legacy_readonly/)
  assert.match(sectionSource, /confirmed/)
})

test('accounting confirmation refuses unsaved draft edits', () => {
  assert.match(sectionSource, /isDraftDirty/)
  assert.match(sectionSource, /请先保存最新草稿后再执行会计确认/)
})

test('project persistence path continues to sanitize every configured contract project', () => {
  assert.match(appSource, /sanitizeProjectForPersistence\(normalizedProject\)/)
  assert.match(appSource, /contractRevenueSetupStatus === 'not_started'/)
  assert.doesNotMatch(appSource, /setProjects\([^\n]*projectRevenueProjects/)
})

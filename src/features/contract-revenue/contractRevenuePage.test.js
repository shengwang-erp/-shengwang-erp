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

test('original contract UI is inclusive-first, derives read-only yen fields, and has no confirmation action', () => {
  assert.match(sectionSource, /需要完成历史合同迁移/)
  assert.match(sectionSource, /含税总金额（日元）/u)
  assert.match(sectionSource, /税率（%）/u)
  assert.match(sectionSource, /税拔金额（日元）/u)
  assert.match(sectionSource, /税额（日元）/u)
  assert.ok(
    sectionSource.indexOf('含税总金额（日元）') <
      sectionSource.indexOf('税率（%）'),
  )
  assert.match(sectionSource, /name="taxExclusiveAmount"[\s\S]*readOnly/u)
  assert.match(sectionSource, /name="taxAmount"[\s\S]*readOnly/u)
  assert.match(sectionSource, /保存合同/u)
  assert.doesNotMatch(sectionSource, /会计确认/u)
  assert.match(sectionSource, /legacy_readonly/)
  assert.match(sectionSource, /confirmed/)
})

test('original contract waits for database persistence and keeps account-scoped drafts until success', () => {
  assert.match(sectionSource, /createOriginalContractDraftStore/u)
  assert.match(sectionSource, /await onProjectChange\(nextProject\)/u)
  assert.match(sectionSource, /draftStore\.clear/u)
  assert.match(sectionSource, /保存失败[\s\S]*保留/u)
  assert.match(pageSource, /canEditContract=\{canUpdateFinancials\}/u)
})

test('existing downstream revenue activity blocks direct original-contract edits', () => {
  assert.match(pageSource, /editBlockedByRevenueActivity/u)
  assert.match(
    pageSource,
    /hasActiveContractRevenueRows\(contractChanges, project\.projectId\)/u,
  )
  assert.match(sectionSource, /原始合同金额不能直接修改/u)
})

test('project persistence path continues to sanitize every configured contract project', () => {
  assert.match(appSource, /sanitizeProjectForPersistence\(normalizedProject\)/)
  assert.match(appSource, /projectService\.updateProject\(/u)
  assert.match(appSource, /contractRevenueSetupStatus === 'not_started'/)
  assert.doesNotMatch(appSource, /setProjects\([^\n]*projectRevenueProjects/)
})

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function readSource(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8').catch(() => '')
}

const [appSource, panelSource, pageSource, originalSectionSource, localMigrationSource] =
  await Promise.all([
    readSource('../../App.jsx'),
    readSource('./ContractRevenueMigrationPanel.jsx'),
    readSource('./ContractRevenuePage.jsx'),
    readSource('./OriginalContractSection.jsx'),
    readSource('../../services/contractRevenueLocalMigration.js'),
  ])

test('system settings contains an independent local contract migration panel before cloud upload', () => {
  assert.match(panelSource, /function ContractRevenueMigrationPanel/)
  assert.match(appSource, /import ContractRevenueMigrationPanel from/)
  assert.match(appSource, /<ContractRevenueMigrationPanel/)
  const panelIndex = appSource.indexOf('<ContractRevenueMigrationPanel')
  const cloudMigrationIndex = appSource.indexOf('localStorage → Supabase 数据迁移')
  assert.ok(panelIndex >= 0 && cloudMigrationIndex > panelIndex)
  assert.match(panelSource, /迁移通过服务端安全事务执行/)
  assert.doesNotMatch(localMigrationSource, /from ['"].*baseRecordService/)
  assert.doesNotMatch(localMigrationSource, /supabase/i)
})

test('the panel only previews on demand and requires an explicit confirmation before execution', () => {
  assert.match(panelSource, /loadPreview/)
  assert.match(panelSource, /executeMigration/)
  assert.match(panelSource, /只读预览/)
  assert.match(panelSource, /执行云端迁移/)
  assert.match(panelSource, /window\.confirm\(/)
  assert.doesNotMatch(panelSource, /useEffect/)
  assert.match(panelSource, /migrationProjectCount/)
  assert.match(panelSource, /openingReceiptCount/)
  assert.match(panelSource, /warnings/)
  assert.match(panelSource, /exceptions/)
  assert.match(panelSource, /projectResults/)
})

test('migration refreshes local project and receipt state without restoring the removed review callback', () => {
  assert.match(appSource, /refreshStoredProjectsFromLocal/)
  assert.match(appSource, /executeContractMigration/)
  assert.match(appSource, /executeMigration={executeContractMigration}/)
  assert.match(appSource, /loadPreview={loadContractMigrationPreview}/)
  assert.match(appSource, /p_expected_legacy_contract: project/u)
  assert.doesNotMatch(appSource, /handleHistoricalContractReview/)
  assert.doesNotMatch(appSource, /onHistoricalReview/)
})

test('historical contract values remain visible and usable without a review action', () => {
  assert.match(originalSectionSource, /needsManualReview/)
  assert.match(originalSectionSource, /历史合同资料已保留；金额完整有效时可直接用于收款业务。/)
  assert.match(originalSectionSource, /历史记录人/)
  assert.match(originalSectionSource, /历史记录时间/)
  assert.doesNotMatch(originalSectionSource, /confirmHistoricalContractReview|确认历史合同复核|会计确认/)
  assert.doesNotMatch(pageSource, /onHistoricalReview/)
})

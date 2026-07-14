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
  assert.match(panelSource, /云端表结构尚未执行，当前仅处理本地数据/)
  assert.doesNotMatch(localMigrationSource, /from ['"].*baseRecordService/)
  assert.doesNotMatch(localMigrationSource, /supabase/i)
})

test('the panel only previews on demand and requires an explicit confirmation before execution', () => {
  assert.match(panelSource, /previewLocalContractRevenueMigration\(/)
  assert.match(panelSource, /executeLocalContractRevenueMigration\(/)
  assert.match(panelSource, /只读预览/)
  assert.match(panelSource, /执行本地迁移/)
  assert.match(panelSource, /window\.confirm\(/)
  assert.doesNotMatch(panelSource, /useEffect/)
  assert.match(panelSource, /migrationProjectCount/)
  assert.match(panelSource, /openingReceiptCount/)
  assert.match(panelSource, /warnings/)
  assert.match(panelSource, /exceptions/)
  assert.match(panelSource, /projectResults/)
})

test('migration and historical review refresh local project and receipt state without cloud persistence', () => {
  assert.match(appSource, /refreshStoredProjectsFromLocal/)
  assert.match(appSource, /refreshProjectReceiptsFromLocal/)
  assert.match(appSource, /handleLocalContractRevenueMigrationComplete/)
  assert.match(appSource, /handleHistoricalContractReview/)
  assert.match(appSource, /createLocalStorageUpsertRecord/)
  assert.match(appSource, /onMigrationComplete=\{handleLocalContractRevenueMigrationComplete\}/)
  assert.match(appSource, /onHistoricalReview=\{handleHistoricalContractReview\}/)
  assert.match(
    appSource,
    /\[projects, projectContractChanges, projectPaymentPlans, projectReceipts\]/,
  )
})

test('the original contract area exposes one-time strict historical review while leaving the snapshot unchanged until confirmation', () => {
  assert.match(pageSource, /revenueSnapshot=\{revenueSnapshot\}/)
  assert.match(pageSource, /onHistoricalReview=\{onHistoricalReview\}/)
  assert.match(originalSectionSource, /confirmHistoricalContractReview\(/)
  assert.match(originalSectionSource, /needsManualReview/)
  assert.match(originalSectionSource, /确认历史合同复核/)
  assert.match(originalSectionSource, /复核确认前/)
  assert.match(originalSectionSource, /adjustedTaxInclusiveAmount/)
  assert.match(originalSectionSource, /paymentProgress/)
  for (const field of [
    'taxExclusiveAmount',
    'taxRate',
    'taxAmount',
    'taxInclusiveAmount',
  ]) {
    assert.match(originalSectionSource, new RegExp(`name="${field}"`))
  }
})

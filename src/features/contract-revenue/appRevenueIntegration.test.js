import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appSource = await readFile(new URL('../../App.jsx', import.meta.url), 'utf8')

test('App loads all contract revenue records and memoizes the project snapshot collection', () => {
  assert.match(
    appSource,
    /const \[projectContractChanges, setProjectContractChanges\] = useState\(\[\]\)/,
  )
  assert.match(
    appSource,
    /const \[projectPaymentPlans, setProjectPaymentPlans\] = useState\(\[\]\)/,
  )
  assert.match(
    appSource,
    /const \[projectReceipts, setProjectReceipts\] = useState\(\[\]\)/,
  )
  assert.match(appSource, /const projectRevenueSnapshots = useMemo\(/)
  assert.match(appSource, /buildProjectRevenueSnapshotCollection\(/)
  assert.match(appSource, /getList\(key\)/)
  assert.match(appSource, /projectContractChanges: CONTRACT_REVENUE_STORAGE_KEYS\.contractChanges/)
  assert.match(appSource, /projectPaymentPlans: CONTRACT_REVENUE_STORAGE_KEYS\.paymentPlans/)
  assert.match(appSource, /projectReceipts: CONTRACT_REVENUE_STORAGE_KEYS\.projectReceipts/)
})

test('read-only revenue models reach display pages while Home gets only its authorized summary', () => {
  assert.match(
    appSource,
    /<ProjectPage\s+projects=\{projects\}\s+projectRevenueSnapshots=\{projectRevenueSnapshots\}/,
  )
  assert.match(appSource, /<DashboardPage\s+projects=\{projectRevenueProjects\}/)
  assert.match(appSource, /projects:\s*projectRevenueProjects/)
  assert.match(appSource, /<HomePage\s+summary=\{homeSummary\}/)
  assert.doesNotMatch(appSource, /<HomePage\s+projects=/)
  assert.doesNotMatch(appSource, /setProjects\([^\n]*projectRevenue/)
  assert.doesNotMatch(appSource, /setStoredProjects\([^\n]*projectRevenue/)
  assert.doesNotMatch(appSource, /<ProjectPage\s+projects=\{projectRevenueProjects\}/)
  assert.match(
    appSource,
    /return resolvedProjects\.map\(\(project\) => prepareProjectForPersistence\(project\)\)/,
  )
  assert.match(appSource, /sanitizeProjectForPersistence\(normalizedProject\)/)
})

test('App profit paths use the tax-exclusive anchor instead of compatibility contractAmount', () => {
  assert.match(appSource, /getProfitAnchorTaxExclusiveAmount\(project\)/)
  assert.match(appSource, /totalProfitAnchorTaxExclusiveAmount/)
  assert.doesNotMatch(
    appSource,
    /const estimatedGrossProfit\s*=\s*toAmount\(project\.contractAmount\)/,
  )
})

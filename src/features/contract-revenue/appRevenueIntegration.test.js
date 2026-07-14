import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const appSource = await readFile(new URL('../../App.jsx', import.meta.url), 'utf8')

test('App loads all contract revenue records and memoizes the project snapshot collection', () => {
  assert.match(
    appSource,
    /const \[projectContractChanges, setProjectContractChanges\] = usePersistentState\(\s*STORAGE_KEYS\.projectContractChanges/,
  )
  assert.match(
    appSource,
    /const \[projectPaymentPlans\] = usePersistentState\(\s*STORAGE_KEYS\.projectPaymentPlans/,
  )
  assert.match(
    appSource,
    /const \[projectReceipts\] = usePersistentState\(\s*STORAGE_KEYS\.projectReceipts/,
  )
  assert.match(appSource, /const projectRevenueSnapshots = useMemo\(/)
  assert.match(appSource, /buildProjectRevenueSnapshotCollection\(/)
})

test('read-only revenue models reach display pages while project editing keeps raw projects', () => {
  assert.match(
    appSource,
    /<ProjectPage\s+projects=\{projects\}\s+projectRevenueSnapshots=\{projectRevenueSnapshots\}/,
  )
  assert.match(appSource, /<DashboardPage\s+projects=\{projectRevenueProjects\}/)
  assert.match(appSource, /<HomePage\s+projects=\{projectRevenueProjects\}/)
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

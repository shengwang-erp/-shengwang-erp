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
  assert.match(appSource, /const cloudLoader = options\.cloudLoader \|\| getList/)
  assert.match(appSource, /await cloudLoader\(key\)/)
  assert.match(appSource, /projectContractChanges: CONTRACT_REVENUE_STORAGE_KEYS\.contractChanges/)
  assert.match(appSource, /projectPaymentPlans: CONTRACT_REVENUE_STORAGE_KEYS\.paymentPlans/)
  assert.match(appSource, /projectReceipts: CONTRACT_REVENUE_STORAGE_KEYS\.projectReceipts/)
})

test('read-only revenue models reach display pages while Home gets only its authorized summary', () => {
  assert.match(
    appSource,
    /<ProjectPage\s+projects=\{projects\}\s+projectRevenueSnapshots=\{projectRevenueSnapshots\}/,
  )
  assert.match(
    appSource,
    /contractRevenue:\s*projectPromiseSource\(contractRevenueRawState,[\s\S]*?data:\s*projectRevenueProjects/u,
  )
  assert.match(
    appSource,
    /receipts:\s*projectPromiseSource\(contractRevenueRawState,[\s\S]*?data:\s*projectReceipts/u,
  )
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

test('App delegates dashboard profit to the tax-exclusive domain without local revenue arithmetic', () => {
  assert.match(
    appSource,
    /import \{ buildExecutiveDashboardReadModel \} from '.\/features\/executive-dashboard\/executiveDashboardDomain\.js'/u,
  )
  const start = appSource.indexOf('function DashboardPage({')
  const end = appSource.indexOf('\nfunction PageShell', start)
  const dashboard = appSource.slice(start, end)
  assert.match(dashboard, /buildExecutiveDashboardReadModel\(\{/u)
  assert.doesNotMatch(dashboard, /adjustedTaxInclusiveAmount|contractAmount|getProfitAnchorTaxExclusiveAmount/u)
  assert.doesNotMatch(
    appSource,
    /adjustedTaxInclusiveAmount\s*-|const estimatedGrossProfit\s*=\s*toAmount\(project\.contractAmount\)/,
  )
})

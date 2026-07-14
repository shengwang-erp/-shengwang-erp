import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function readSource(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8').catch(() => '')
}

const [appSource, pageSource, sectionSource] = await Promise.all([
  readSource('../../App.jsx'),
  readSource('./ContractRevenuePage.jsx'),
  readSource('./ContractChangesSection.jsx'),
])

test('contract changes are implemented in an independent section connected to the revenue page', () => {
  assert.match(sectionSource, /function ContractChangesSection/)
  assert.match(pageSource, /import ContractChangesSection from/)
  assert.match(pageSource, /<ContractChangesSection/)
  assert.match(pageSource, /contractChanges={contractChanges}/)
  assert.match(pageSource, /onCreateContractChange={onCreateContractChange}/)
  assert.match(pageSource, /onVoidContractChange={onVoidContractChange}/)
})

test('change form exposes every required field and delegates strict domain validation', () => {
  assert.match(sectionSource, /prepareContractChangeInput\(/)
  assert.match(sectionSource, /name="changeType"/)
  assert.match(sectionSource, />增项</)
  assert.match(sectionSource, />减项</)
  for (const field of [
    'taxExclusiveAmount',
    'taxRate',
    'taxAmount',
    'taxInclusiveAmount',
    'effectiveDate',
    'reason',
  ]) {
    assert.match(sectionSource, new RegExp(`name="${field}"`))
  }
  assert.match(sectionSource, /min="1"/)
  assert.match(sectionSource, /原始合同完成会计确认后才能新增增减项/)
  assert.match(sectionSource, /需要迁移后复核/)
})

test('change list uses running balances and exposes voiding without edit or hard delete actions', () => {
  assert.match(sectionSource, /buildContractChangeRunningBalances\(/)
  assert.match(sectionSource, /runningTaxExclusiveAmount/)
  assert.match(sectionSource, /runningTaxInclusiveAmount/)
  assert.match(sectionSource, /prepareContractChangeVoid\(/)
  assert.match(sectionSource, /const persistedChange = contractChanges\.find\(/)
  assert.match(sectionSource, /onVoidContractChange\(persistedChange, details\)/)
  assert.match(sectionSource, /作废原因/)
  assert.match(sectionSource, />\s*作废\s*</)
  assert.doesNotMatch(sectionSource, /onEditContractChange/)
  assert.doesNotMatch(sectionSource, /onDeleteContractChange/)
  assert.doesNotMatch(sectionSource, /updateContractChange/)
  assert.doesNotMatch(sectionSource, /deleteContractChange/)
})

test('App persists create and void as single records and refreshes the snapshot collection state', () => {
  assert.match(
    appSource,
    /createContractChange as persistContractChange/,
  )
  assert.match(
    appSource,
    /voidContractChange as persistVoidContractChange/,
  )
  assert.match(
    appSource,
    /const \[projectContractChanges, setProjectContractChanges\] = usePersistentState/,
  )
  assert.match(appSource, /cloudPersistence: 'record'/)
  assert.match(appSource, /await persistContractChange\(input\)/)
  assert.match(appSource, /await persistVoidContractChange\(record, details\)/)
  assert.match(appSource, /setProjectContractChanges\(/)
  assert.match(appSource, /\[projects, projectContractChanges, projectPaymentPlans, projectReceipts\]/)
  assert.match(appSource, /contractChanges=\{projectContractChanges\}/)
  assert.match(appSource, /onCreateContractChange=\{handleCreateContractChange\}/)
  assert.match(appSource, /onVoidContractChange=\{handleVoidContractChange\}/)
})

test('record-mode state updates keep local cache but do not invoke whole-table cloud save', () => {
  assert.match(appSource, /function usePersistentState\(key, fallback, options = \{\}\)/)
  assert.match(appSource, /cloudPersistence === 'list'/)
  assert.match(appSource, /window\.localStorage\.setItem\(key, JSON\.stringify\(resolvedValue\)\)/)
})

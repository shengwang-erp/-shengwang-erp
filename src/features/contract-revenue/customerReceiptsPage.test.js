import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function readSource(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8').catch(() => '')
}

const [appSource, pageSource, sectionSource, serviceSource] = await Promise.all([
  readSource('../../App.jsx'),
  readSource('./ContractRevenuePage.jsx'),
  readSource('./CustomerReceiptsSection.jsx'),
  readSource('../../services/contractRevenueService.js'),
])

test('customer receipts use an independent section connected to the contract revenue page', () => {
  assert.match(sectionSource, /function CustomerReceiptsSection/)
  assert.match(pageSource, /import CustomerReceiptsSection from/)
  assert.match(pageSource, /<CustomerReceiptsSection/)
  assert.match(pageSource, /project=\{project\}/)
  assert.match(pageSource, /revenueSnapshot=\{revenueSnapshot\}/)
  assert.match(pageSource, /paymentPlans=\{paymentPlans\}/)
  assert.match(pageSource, /receipts=\{receipts\}/)
  assert.match(pageSource, /currentUser=\{currentUser\}/)
  assert.match(pageSource, /onCreateCustomerReceipt=\{onCreateCustomerReceipt\}/)
  assert.match(pageSource, /onVoidCustomerReceipt=\{onVoidCustomerReceipt\}/)
})

test('the receipt form exposes every required field and all four supported stages', () => {
  assert.match(sectionSource, /canManageCustomerReceipts\(/)
  assert.match(sectionSource, /prepareCustomerReceiptInput\(/)
  for (const field of [
    'stage',
    'taxInclusiveAmount',
    'receivedDate',
    'paymentMethod',
    'bankReference',
    'remark',
  ]) {
    assert.match(sectionSource, new RegExp(`name="${field}"`))
  }
  assert.match(sectionSource, /value="initial"/)
  assert.match(sectionSource, /value="middle"/)
  assert.match(sectionSource, /value="final"/)
  assert.match(sectionSource, /value="unallocated"/)
  assert.match(sectionSource, /min="1"/)
  assert.match(sectionSource, /step="1"/)
  assert.match(sectionSource, /原始合同完成会计确认后才能登记实际收款/)
  assert.match(sectionSource, /需要迁移后复核/)
})

test('the page shows stage and project receipt summaries with prominent overpayment flags', () => {
  assert.match(sectionSource, /buildCustomerReceiptViewModel\(/)
  assert.match(sectionSource, /plannedTaxInclusiveAmount/)
  assert.match(sectionSource, /receivedTaxInclusiveAmount/)
  assert.match(sectionSource, /remainingTaxInclusiveAmount/)
  assert.match(sectionSource, /stageSummary\.status/)
  assert.match(sectionSource, /totalReceivedTaxInclusiveAmount/)
  assert.match(sectionSource, /outstandingTaxInclusiveAmount/)
  assert.match(sectionSource, /paymentProgress/)
  assert.match(sectionSource, /overpaidTaxInclusiveAmount/)
  assert.match(sectionSource, /hasStageOverpayment/)
  assert.match(sectionSource, /hasContractOverpayment/)
  assert.match(sectionSource, /role="alert"/)
  assert.match(sectionSource, /已保留真实到账金额/)
})

test('receipt rows can only be voided with a reason and expose no edit or hard-delete workflow', () => {
  assert.match(sectionSource, /prepareCustomerReceiptVoid\(/)
  assert.match(sectionSource, /const persistedReceipt = receipts\.find\(/)
  assert.match(
    sectionSource,
    /onVoidCustomerReceipt\(persistedReceipt, details\)/,
  )
  assert.match(sectionSource, /作废原因/)
  assert.match(sectionSource, />\s*作废\s*</)
  assert.doesNotMatch(sectionSource, /onEditCustomerReceipt/)
  assert.doesNotMatch(sectionSource, /onDeleteCustomerReceipt/)
  assert.doesNotMatch(sectionSource, /updateProjectReceipt/)
  assert.doesNotMatch(sectionSource, /deleteProjectReceipt/)
  assert.doesNotMatch(sectionSource, /attachment|附件上传/)
})

test('App adds single-record create and void callbacks and refreshes receipts in record mode', () => {
  assert.match(
    appSource,
    /createProjectReceipt as persistCreateCustomerReceipt/,
  )
  assert.match(
    appSource,
    /voidProjectReceipt as persistVoidCustomerReceipt/,
  )
  assert.match(
    appSource,
    /const \[projectReceipts, setProjectReceipts\] = usePersistentState\(\s*STORAGE_KEYS\.projectReceipts,\s*\[\],\s*\{\s*\.\.\.persistenceOptions,\s*cloudPersistence:\s*'record',?\s*\}/,
  )
  assert.match(appSource, /const handleCreateCustomerReceipt = async \(input\)/)
  assert.match(appSource, /await persistCreateCustomerReceipt\(input\)/)
  assert.match(appSource, /const handleVoidCustomerReceipt = async \(record, details\)/)
  assert.match(appSource, /await persistVoidCustomerReceipt\(record, details\)/)
  assert.match(appSource, /setProjectReceipts\(/)
  assert.match(appSource, /onCreateCustomerReceipt=\{handleCreateCustomerReceipt\}/)
  assert.match(appSource, /onVoidCustomerReceipt=\{handleVoidCustomerReceipt\}/)
  assert.match(
    appSource,
    /\[projects, projectContractChanges, projectPaymentPlans, projectReceipts\]/,
  )
  assert.match(serviceSource, /createProjectReceipt: \(input\) =>\s*createRecord\(/)
  assert.match(serviceSource, /voidProjectReceipt: \(input, details\) =>\s*voidRecord\(/)
})

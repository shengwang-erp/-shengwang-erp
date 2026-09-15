import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function readSource(relativePath) { return readFile(new URL(relativePath, import.meta.url), 'utf8').catch(() => '') }
const [appSource, pageSource, sectionSource] = await Promise.all([readSource('../../App.jsx'), readSource('./ContractRevenuePage.jsx'), readSource('./PaymentPlanSection.jsx')])

test('payment plans connect to the revenue page through an update-gated atomic set save', () => {
  assert.match(sectionSource, /function PaymentPlanSection/)
  assert.match(pageSource, /import PaymentPlanSection from/)
  assert.match(pageSource, /<PaymentPlanSection/)
  assert.match(pageSource, /paymentPlans=\{paymentPlans\}/)
  assert.match(pageSource, /receipts=\{receipts\}/)
  assert.match(pageSource, /revenueSnapshot=\{revenueSnapshot\}/)
  assert.match(pageSource, /onSavePaymentPlanSet=\{canUpdateFinancials \? onSavePaymentPlanSet : undefined\}/)
})

test('the form supports blank defaults, configurable periods, names, percentage, date, remark and calculated amount', () => {
  assert.match(sectionSource, /createBlankPaymentPlans/)
  assert.match(sectionSource, /三期/)
  assert.match(sectionSource, /四期/)
  assert.match(sectionSource, /平均分配/)
  assert.match(sectionSource, /allocationWeight/)
  assert.match(sectionSource, /dueDate/)
  assert.match(sectionSource, /remark/)
  assert.match(sectionSource, /plannedTaxInclusiveAmount/)
  assert.match(sectionSource, /保存收款计划/)
  assert.doesNotMatch(sectionSource, /plannedTaxInclusiveAmount.*保存。/)
})

test('legacy and unconfirmed projects stay read-only while confirmed plans use domain validation and drafts', () => {
  assert.match(sectionSource, /canManagePaymentPlans\(/)
  assert.match(sectionSource, /preparePaymentPlanSetSave\(/)
  assert.match(sectionSource, /createPaymentPlanDraftStore/)
  assert.match(sectionSource, /需要迁移后复核/)
  assert.match(sectionSource, /原始合同完成会计确认后才能设置收款计划/)
  assert.match(sectionSource, /creationAllowed/)
})

test('App saves the complete plan set in one service-authoritative operation', () => {
  assert.match(appSource, /savePaymentPlanSet as persistPaymentPlanSet/)
  assert.match(appSource, /const \[projectPaymentPlans, setProjectPaymentPlans\] = useState\(\[\]\)/)
  assert.match(appSource, /Promise\.all\(\[loadContractChanges\(\), loadPaymentPlans\(\), loadProjectReceipts\(\)\]\)/)
  assert.match(appSource, /const handleSavePaymentPlanSet = async \(projectId, plans\)/)
  assert.match(appSource, /persistPaymentPlanSet\(projectId, plans\)/)
  assert.match(appSource, /setProjectPaymentPlans\(/)
  assert.match(appSource, /onSavePaymentPlanSet=\{handleSavePaymentPlanSet\}/)
})

test('payment plan page has no hard-delete or void workflow', () => {
  assert.doesNotMatch(sectionSource, /deletePaymentPlan/)
  assert.doesNotMatch(sectionSource, /voidPaymentPlan/)
  assert.doesNotMatch(sectionSource, /onDeletePaymentPlan/)
  assert.doesNotMatch(sectionSource, /onVoidPaymentPlan/)
})

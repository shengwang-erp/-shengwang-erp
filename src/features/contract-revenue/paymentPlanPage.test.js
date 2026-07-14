import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function readSource(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8').catch(() => '')
}

const [appSource, pageSource, sectionSource] = await Promise.all([
  readSource('../../App.jsx'),
  readSource('./ContractRevenuePage.jsx'),
  readSource('./PaymentPlanSection.jsx'),
])

test('payment plans use an independent section connected to the contract revenue page', () => {
  assert.match(sectionSource, /function PaymentPlanSection/)
  assert.match(pageSource, /import PaymentPlanSection from/)
  assert.match(pageSource, /<PaymentPlanSection/)
  assert.match(pageSource, /paymentPlans=\{paymentPlans\}/)
  assert.match(pageSource, /receipts=\{receipts\}/)
  assert.match(pageSource, /revenueSnapshot=\{revenueSnapshot\}/)
  assert.match(pageSource, /onSavePaymentPlan=\{onSavePaymentPlan\}/)
})

test('the form exposes fixed initial, middle and final stages with percentage, date, remark and stored amount', () => {
  assert.match(sectionSource, /PAYMENT_STAGE_LABELS/)
  assert.match(sectionSource, /首期款/)
  assert.match(sectionSource, /中期款/)
  assert.match(sectionSource, /尾款/)
  assert.match(sectionSource, /allocationWeight/)
  assert.match(sectionSource, /dueDate/)
  assert.match(sectionSource, /remark/)
  assert.match(sectionSource, /plannedTaxInclusiveAmount/)
  assert.doesNotMatch(sectionSource, /name="stage"/)
})

test('legacy and unconfirmed projects stay read-only while confirmed plans use domain validation', () => {
  assert.match(sectionSource, /canManagePaymentPlans\(/)
  assert.match(sectionSource, /preparePaymentPlanSave\(/)
  assert.match(sectionSource, /需要迁移后复核/)
  assert.match(sectionSource, /原始合同完成会计确认后才能设置收款计划/)
  assert.match(sectionSource, /creationAllowed/)
})

test('manual allocation is prominent and only unlocked stage amounts become editable', () => {
  assert.match(sectionSource, /buildPaymentPlanEditorState\(/)
  assert.match(sectionSource, /needsAccountingAction/)
  assert.match(sectionSource, /需要会计处理/)
  assert.match(sectionSource, /hasPendingReallocation/)
  assert.match(sectionSource, /plan\.locked/)
  assert.match(
    sectionSource,
    /disabled=\{editorState\.mode !== 'manual' \|\| plan\.locked\}/,
  )
  assert.match(sectionSource, /全部阶段合计必须等于调整后税込合同金额/)
})

test('App saves each plan with create or update single-record service and refreshes snapshot state', () => {
  assert.match(appSource, /createPaymentPlan as persistCreatePaymentPlan/)
  assert.match(appSource, /updatePaymentPlan as persistUpdatePaymentPlan/)
  assert.match(
    appSource,
    /const \[projectPaymentPlans, setProjectPaymentPlans\] = usePersistentState/,
  )
  assert.match(appSource, /STORAGE_KEYS\.projectPaymentPlans,\s*\[\],\s*\{ cloudPersistence: 'record' \}/)
  assert.match(appSource, /const handleSavePaymentPlan = async \(input\)/)
  assert.match(appSource, /input\.planId\s*\? await persistUpdatePaymentPlan\(input\)/)
  assert.match(appSource, /: await persistCreatePaymentPlan\(input\)/)
  assert.match(appSource, /setProjectPaymentPlans\(/)
  assert.match(appSource, /paymentPlans=\{projectPaymentPlans\}/)
  assert.match(appSource, /receipts=\{projectReceipts\}/)
  assert.match(appSource, /onSavePaymentPlan=\{handleSavePaymentPlan\}/)
  assert.match(appSource, /\[projects, projectContractChanges, projectPaymentPlans, projectReceipts\]/)
})

test('payment plan page has no hard-delete or void workflow', () => {
  assert.doesNotMatch(sectionSource, /deletePaymentPlan/)
  assert.doesNotMatch(sectionSource, /voidPaymentPlan/)
  assert.doesNotMatch(sectionSource, /onDeletePaymentPlan/)
  assert.doesNotMatch(sectionSource, /onVoidPaymentPlan/)
})

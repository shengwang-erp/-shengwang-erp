import assert from 'node:assert/strict'
import test from 'node:test'

import { ContractRevenueValidationError } from './contractRevenueValidation.js'

const originalContract = await import('./originalContract.js').catch(() => ({}))

function requireExport(name) {
  assert.equal(typeof originalContract[name], 'function', `${name} must be exported`)
  return originalContract[name]
}

function pendingProject(overrides = {}) {
  return {
    projectId: 'P100',
    projectName: '新项目',
    contractRevenueSetupStatus: 'not_started',
    ...overrides,
  }
}

function draftProject(overrides = {}) {
  return {
    ...pendingProject(),
    contractRevenueSchemaVersion: 1,
    contractRevenueSetupStatus: 'configured',
    contractConfirmationStatus: 'draft',
    originalContractTaxExclusiveAmount: 1000000,
    originalContractTaxRate: 10,
    originalContractTaxAmount: 100000,
    originalContractTaxInclusiveAmount: 1100000,
    ...overrides,
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

test('new project initialization marks contract setup pending and strips compatibility fields', () => {
  const initializeOriginalContractProject = requireExport(
    'initializeOriginalContractProject',
  )
  const source = {
    projectId: 'P100',
    projectName: '新项目',
    contractAmount: 1100000,
    paidAmount: 100000,
    paymentProgress: 9,
    profitAnchorTaxExclusiveAmount: 1000000,
  }
  const original = clone(source)

  const result = initializeOriginalContractProject(source)

  assert.equal(result.contractRevenueSetupStatus, 'not_started')
  assert.equal(Object.hasOwn(result, 'contractAmount'), false)
  assert.equal(Object.hasOwn(result, 'paidAmount'), false)
  assert.equal(Object.hasOwn(result, 'paymentProgress'), false)
  assert.equal(Object.hasOwn(result, 'profitAnchorTaxExclusiveAmount'), false)
  assert.deepEqual(source, original)
})

test('original contract mode distinguishes legacy, pending, draft and locked projects', () => {
  const getOriginalContractMode = requireExport('getOriginalContractMode')

  assert.equal(
    getOriginalContractMode({ projectId: 'P-LEGACY', contractAmount: 500000, paidAmount: 0 }),
    'legacy_readonly',
  )
  assert.equal(getOriginalContractMode(pendingProject()), 'not_started')
  assert.equal(getOriginalContractMode(draftProject()), 'draft')
  assert.equal(
    getOriginalContractMode(draftProject({ contractConfirmationStatus: 'confirmed' })),
    'confirmed',
  )
  assert.equal(
    getOriginalContractMode(
      draftProject({ contractConfirmationStatus: 'historical_migrated_confirmed' }),
    ),
    'confirmed',
  )
})

test('saving an original contract draft uses strict validation and stores normalized tax fields', () => {
  const saveOriginalContractDraft = requireExport('saveOriginalContractDraft')
  const source = pendingProject({ contractAmount: 1, paidAmount: 2 })
  const original = clone(source)

  const result = saveOriginalContractDraft(source, {
    taxExclusiveAmount: '1000000',
    taxRate: '10',
    taxAmount: '100000',
    taxInclusiveAmount: '1100000',
  })

  assert.equal(result.contractRevenueSchemaVersion, 1)
  assert.equal(result.contractRevenueSetupStatus, 'configured')
  assert.equal(result.contractConfirmationStatus, 'draft')
  assert.equal(result.originalContractTaxExclusiveAmount, 1000000)
  assert.equal(result.originalContractTaxRate, 10)
  assert.equal(result.originalContractTaxAmount, 100000)
  assert.equal(result.originalContractTaxInclusiveAmount, 1100000)
  assert.equal(result.needsManualReview, false)
  assert.equal(Object.hasOwn(result, 'contractAmount'), false)
  assert.equal(Object.hasOwn(result, 'paidAmount'), false)
  assert.deepEqual(source, original)
})

test('draft save rejects blank and inconsistent amounts through existing strict validation', () => {
  const saveOriginalContractDraft = requireExport('saveOriginalContractDraft')

  assert.throws(
    () =>
      saveOriginalContractDraft(pendingProject(), {
        taxExclusiveAmount: '',
        taxRate: 10,
        taxAmount: 100000,
        taxInclusiveAmount: 1100000,
      }),
    (error) =>
      error instanceof ContractRevenueValidationError &&
      error.field === 'taxExclusiveAmount',
  )
  assert.throws(
    () =>
      saveOriginalContractDraft(pendingProject(), {
        taxExclusiveAmount: 1000000,
        taxRate: 10,
        taxAmount: 100000,
        taxInclusiveAmount: 1099999,
      }),
    (error) =>
      error instanceof ContractRevenueValidationError &&
      error.field === 'taxInclusiveAmount',
  )
})

test('accounting confirmation transitions a draft to confirmed and records actor and time', () => {
  const confirmOriginalContract = requireExport('confirmOriginalContract')
  const source = draftProject()
  const original = clone(source)

  const result = confirmOriginalContract(
    source,
    { employeeId: 'E009', name: '会计王' },
    '2026-07-14T10:20:30.000Z',
  )

  assert.equal(result.contractConfirmationStatus, 'confirmed')
  assert.equal(result.contractConfirmedById, 'E009')
  assert.equal(result.contractConfirmedByName, '会计王')
  assert.equal(result.contractConfirmedAt, '2026-07-14T10:20:30.000Z')
  assert.equal(result.originalContractTaxExclusiveAmount, 1000000)
  assert.equal(result.originalContractTaxInclusiveAmount, 1100000)
  assert.equal(Object.hasOwn(result, 'contractAmount'), false)
  assert.deepEqual(source, original)
})

test('confirmed and historical confirmed original contracts are locked against direct edits', () => {
  const saveOriginalContractDraft = requireExport('saveOriginalContractDraft')
  const OriginalContractStateError = requireExport('OriginalContractStateError')
  const input = {
    taxExclusiveAmount: 1200000,
    taxRate: 10,
    taxAmount: 120000,
    taxInclusiveAmount: 1320000,
  }

  for (const contractConfirmationStatus of [
    'confirmed',
    'historical_migrated_confirmed',
  ]) {
    assert.throws(
      () =>
        saveOriginalContractDraft(
          draftProject({ contractConfirmationStatus }),
          input,
        ),
      (error) =>
        error instanceof OriginalContractStateError &&
        error.code === 'original_contract_locked',
    )
  }
})

test('legacy and not-started projects cannot bypass the required draft confirmation transition', () => {
  const confirmOriginalContract = requireExport('confirmOriginalContract')
  const OriginalContractStateError = requireExport('OriginalContractStateError')
  const actor = { employeeId: 'E009', name: '会计王' }

  for (const project of [
    { projectId: 'P-LEGACY', contractAmount: 500000, paidAmount: 0 },
    pendingProject(),
  ]) {
    assert.throws(
      () => confirmOriginalContract(project, actor, '2026-07-14T10:20:30.000Z'),
      (error) =>
        error instanceof OriginalContractStateError &&
        error.code === 'original_contract_draft_required',
    )
  }
})

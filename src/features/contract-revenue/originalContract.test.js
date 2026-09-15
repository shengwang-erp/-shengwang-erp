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

function historicalProject(overrides = {}) {
  return {
    projectId: 'P-HISTORY',
    projectName: '历史项目',
    contractRevenueSchemaVersion: 1,
    contractRevenueSetupStatus: 'configured',
    contractConfirmationStatus: 'historical_migrated_confirmed',
    originalContractTaxExclusiveAmount: 1000000,
    originalContractTaxRate: 0,
    originalContractTaxAmount: 0,
    originalContractTaxInclusiveAmount: 1000000,
    needsManualReview: true,
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

test('inclusive-first calculation rounds tax-exclusive yen and keeps the entered total exact', () => {
  const calculateOriginalContractAmounts = requireExport(
    'calculateOriginalContractAmounts',
  )

  assert.deepEqual(calculateOriginalContractAmounts('110000', '10'), {
    taxExclusiveAmount: 100000,
    taxRate: 10,
    taxAmount: 10000,
    taxInclusiveAmount: 110000,
  })
  assert.deepEqual(calculateOriginalContractAmounts('100000', '10'), {
    taxExclusiveAmount: 90909,
    taxRate: 10,
    taxAmount: 9091,
    taxInclusiveAmount: 100000,
  })
  assert.deepEqual(calculateOriginalContractAmounts('100001', '0'), {
    taxExclusiveAmount: 100001,
    taxRate: 0,
    taxAmount: 0,
    taxInclusiveAmount: 100001,
  })
})

test('inclusive-first calculation rejects negative, fractional, blank, and unsafe yen input', () => {
  const calculateOriginalContractAmounts = requireExport(
    'calculateOriginalContractAmounts',
  )

  for (const taxInclusiveAmount of ['-1', '1.5', '', String(Number.MAX_SAFE_INTEGER + 1)]) {
    assert.throws(
      () => calculateOriginalContractAmounts(taxInclusiveAmount, '10'),
      (error) =>
        error instanceof ContractRevenueValidationError &&
        error.field === 'taxInclusiveAmount',
    )
  }
  assert.throws(
    () => calculateOriginalContractAmounts('1000', '-1'),
    (error) =>
      error instanceof ContractRevenueValidationError && error.field === 'taxRate',
  )
})

test('saved contract validity depends on persisted complete amounts rather than confirmation status', () => {
  const isOriginalContractSaved = requireExport('isOriginalContractSaved')

  for (const contractConfirmationStatus of [
    'draft',
    'confirmed',
    'historical_migrated_confirmed',
    undefined,
  ]) {
    assert.equal(
      isOriginalContractSaved(draftProject({ contractConfirmationStatus })),
      true,
    )
  }
  assert.equal(
    isOriginalContractSaved(draftProject({ contractRevenueSetupStatus: 'not_started' })),
    false,
  )
  assert.equal(
    isOriginalContractSaved(draftProject({ originalContractTaxAmount: undefined })),
    false,
  )
  assert.equal(
    isOriginalContractSaved(draftProject({ originalContractTaxInclusiveAmount: 1099999 })),
    false,
  )
  assert.equal(
    isOriginalContractSaved(draftProject({
      originalContractTaxExclusiveAmount: 90911,
      originalContractTaxRate: 10,
      originalContractTaxAmount: 9089,
      originalContractTaxInclusiveAmount: 100000,
    })),
    false,
  )
  assert.equal(
    isOriginalContractSaved(draftProject({
      originalContractTaxExclusiveAmount: 90910,
      originalContractTaxRate: 10,
      originalContractTaxAmount: 9090,
      originalContractTaxInclusiveAmount: 100000,
    })),
    true,
  )
})

test('rounding warning reports only a one-yen historical discrepancy without rewriting it', () => {
  const getOriginalContractRoundingWarning = requireExport(
    'getOriginalContractRoundingWarning',
  )
  const historical = historicalProject({
    originalContractTaxExclusiveAmount: 90910,
    originalContractTaxRate: 10,
    originalContractTaxAmount: 9090,
    originalContractTaxInclusiveAmount: 100000,
  })

  assert.match(getOriginalContractRoundingWarning(historical), /相差1日元/u)
  assert.equal(historical.originalContractTaxExclusiveAmount, 90910)
  assert.equal(historical.originalContractTaxAmount, 9090)
  assert.equal(
    getOriginalContractRoundingWarning(
      draftProject({
        originalContractTaxExclusiveAmount: 90911,
        originalContractTaxRate: 10,
        originalContractTaxAmount: 9089,
        originalContractTaxInclusiveAmount: 100000,
      }),
    ),
    '',
  )
})

test('saving a complete original contract stores derived amounts without creating confirmation metadata', () => {
  const saveOriginalContract = requireExport('saveOriginalContract')
  const source = pendingProject()

  const result = saveOriginalContract(source, {
    taxInclusiveAmount: '100000',
    taxRate: '10',
    taxExclusiveAmount: '90909',
    taxAmount: '9091',
  })

  assert.equal(result.contractRevenueSetupStatus, 'configured')
  assert.equal(result.contractConfirmationStatus, 'draft')
  assert.equal(result.originalContractTaxExclusiveAmount, 90909)
  assert.equal(result.originalContractTaxAmount, 9091)
  assert.equal(result.originalContractTaxInclusiveAmount, 100000)
  assert.equal(Object.hasOwn(result, 'contractConfirmedById'), false)
  assert.equal(Object.hasOwn(result, 'contractConfirmedAt'), false)
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


test('historically confirmed contracts retain their existing edit lock after confirmation removal', () => {
  const saveOriginalContract = requireExport('saveOriginalContract')
  const OriginalContractStateError = requireExport('OriginalContractStateError')

  for (const contractConfirmationStatus of ['confirmed', 'historical_migrated_confirmed']) {
    assert.throws(
      () => saveOriginalContract(
        draftProject({ contractConfirmationStatus }),
        { taxInclusiveAmount: '1320000', taxRate: '10' },
      ),
      (error) => error instanceof OriginalContractStateError && error.code === 'original_contract_locked',
    )
  }
})

test('the removed accounting confirmation workflow is no longer exported', () => {
  assert.equal(originalContract.saveOriginalContractDraft, undefined)
  assert.equal(originalContract.confirmOriginalContract, undefined)
  assert.equal(originalContract.confirmHistoricalContractReview, undefined)
})

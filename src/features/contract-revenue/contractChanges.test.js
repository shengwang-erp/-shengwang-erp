import assert from 'node:assert/strict'
import test from 'node:test'

import { buildProjectRevenueSnapshot } from './contractRevenueCalculations.js'
import { ContractRevenueValidationError } from './contractRevenueValidation.js'

const contractChanges = await import('./contractChanges.js').catch(() => ({}))

function requireExport(name) {
  assert.equal(typeof contractChanges[name], 'function', `${name} must be exported`)
  return contractChanges[name]
}

function confirmedProject(overrides = {}) {
  return {
    projectId: 'P100',
    projectName: '合同项目',
    contractRevenueSchemaVersion: 1,
    contractRevenueSetupStatus: 'configured',
    contractConfirmationStatus: 'confirmed',
    originalContractTaxExclusiveAmount: 1000000,
    originalContractTaxRate: 10,
    originalContractTaxAmount: 100000,
    originalContractTaxInclusiveAmount: 1100000,
    ...overrides,
  }
}

function changeInput(overrides = {}) {
  return {
    changeType: 'increase',
    taxExclusiveAmount: '200000',
    taxRate: '10',
    taxAmount: '20000',
    taxInclusiveAmount: '220000',
    effectiveDate: '2026-07-20',
    reason: '客户追加收纳柜',
    ...overrides,
  }
}

function storedChange(overrides = {}) {
  return {
    changeId: 'change-1',
    projectId: 'P100',
    changeType: 'increase',
    taxExclusiveAmount: 200000,
    taxRate: 10,
    taxAmount: 20000,
    taxInclusiveAmount: 220000,
    effectiveDate: '2026-07-20',
    reason: '客户追加收纳柜',
    statusCode: 'active',
    createdById: 'E009',
    createdByName: '会计王',
    createdAt: '2026-07-14T06:00:00.000Z',
    ...overrides,
  }
}

const actor = { employeeId: 'E009', name: '会计王' }

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function assertValidationError(field) {
  return (error) => {
    assert.ok(error instanceof ContractRevenueValidationError)
    assert.equal(error.field, field)
    return true
  }
}

test('only an explicitly confirmed original contract can create a change', () => {
  const prepareContractChangeInput = requireExport('prepareContractChangeInput')
  const ContractChangeStateError = requireExport('ContractChangeStateError')
  const disallowedProjects = [
    confirmedProject({ contractConfirmationStatus: 'draft' }),
    confirmedProject({ contractConfirmationStatus: undefined }),
    {
      projectId: 'P-LEGACY',
      contractAmount: 1100000,
      paidAmount: 0,
    },
  ]

  for (const project of disallowedProjects) {
    assert.throws(
      () => prepareContractChangeInput(project, [], changeInput(), actor),
      (error) =>
        error instanceof ContractChangeStateError &&
        ['original_contract_confirmation_required', 'legacy_migration_required'].includes(
          error.code,
        ),
    )
  }

  const historical = confirmedProject({
    contractConfirmationStatus: 'historical_migrated_confirmed',
    needsManualReview: true,
  })
  assert.equal(
    prepareContractChangeInput(historical, [], changeInput(), actor).projectId,
    'P100',
  )
})

test('change input uses strict positive tax validation and stores direction only in changeType', () => {
  const prepareContractChangeInput = requireExport('prepareContractChangeInput')
  const project = confirmedProject()

  const result = prepareContractChangeInput(project, [], changeInput(), actor)

  assert.deepEqual(result, {
    projectId: 'P100',
    changeType: 'increase',
    taxExclusiveAmount: 200000,
    taxRate: 10,
    taxAmount: 20000,
    taxInclusiveAmount: 220000,
    effectiveDate: '2026-07-20',
    reason: '客户追加收纳柜',
    createdById: 'E009',
    createdByName: '会计王',
  })
  assert.equal(result.taxExclusiveAmount > 0, true)
  assert.equal(result.taxAmount > 0, true)
  assert.equal(result.taxInclusiveAmount > 0, true)

  for (const [field, value] of [
    ['taxExclusiveAmount', '-1'],
    ['taxAmount', '0'],
    ['taxInclusiveAmount', ''],
  ]) {
    assert.throws(
      () =>
        prepareContractChangeInput(
          project,
          [],
          changeInput({ [field]: value }),
          actor,
        ),
      assertValidationError(field),
    )
  }

  assert.throws(
    () =>
      prepareContractChangeInput(
        project,
        [],
        changeInput({ taxInclusiveAmount: '219999' }),
        actor,
      ),
    assertValidationError('taxInclusiveAmount'),
  )
  assert.throws(
    () =>
      prepareContractChangeInput(
        project,
        [],
        changeInput({ changeType: 'increase', taxExclusiveAmount: '-200000' }),
        actor,
      ),
    assertValidationError('taxExclusiveAmount'),
  )
})

test('change input requires a valid effective date, reason and current operator', () => {
  const prepareContractChangeInput = requireExport('prepareContractChangeInput')
  const project = confirmedProject()

  for (const effectiveDate of ['', '2026-02-30', '2026/07/20']) {
    assert.throws(
      () =>
        prepareContractChangeInput(
          project,
          [],
          changeInput({ effectiveDate }),
          actor,
        ),
      assertValidationError('effectiveDate'),
    )
  }
  assert.throws(
    () => prepareContractChangeInput(project, [], changeInput({ reason: '  ' }), actor),
    assertValidationError('reason'),
  )
  assert.throws(
    () => prepareContractChangeInput(project, [], changeInput(), { name: '会计王' }),
    assertValidationError('createdById'),
  )
})

test('a decrease cannot make adjusted tax-exclusive or tax-inclusive contract totals non-positive', () => {
  const prepareContractChangeInput = requireExport('prepareContractChangeInput')
  const project = confirmedProject()

  assert.throws(
    () =>
      prepareContractChangeInput(
        project,
        [],
        changeInput({
          changeType: 'decrease',
          taxExclusiveAmount: 1000000,
          taxAmount: 100000,
          taxInclusiveAmount: 1100000,
        }),
        actor,
      ),
    assertValidationError('adjustedTaxExclusiveAmount'),
  )

  assert.throws(
    () =>
      prepareContractChangeInput(
        confirmedProject({
          originalContractTaxExclusiveAmount: 100000,
          originalContractTaxRate: 100,
          originalContractTaxAmount: 100000,
          originalContractTaxInclusiveAmount: 200000,
        }),
        [],
        changeInput({
          changeType: 'decrease',
          taxExclusiveAmount: 50000,
          taxRate: 100,
          taxAmount: 150000,
          taxInclusiveAmount: 200000,
        }),
        actor,
      ),
    assertValidationError('adjustedTaxInclusiveAmount'),
  )
})

test('void details keep the record, require actor and reason, and reject a repeated void', () => {
  const prepareContractChangeVoid = requireExport('prepareContractChangeVoid')
  const ContractChangeStateError = requireExport('ContractChangeStateError')
  const project = confirmedProject()
  const change = storedChange()
  const sourceChanges = [change]
  const original = clone(sourceChanges)

  const details = prepareContractChangeVoid(
    project,
    sourceChanges,
    change,
    actor,
    '金额录入错误',
  )

  assert.deepEqual(details, {
    voidReason: '金额录入错误',
    voidedById: 'E009',
    voidedByName: '会计王',
  })
  assert.deepEqual(sourceChanges, original)

  assert.throws(
    () => prepareContractChangeVoid(project, sourceChanges, change, actor, ' '),
    assertValidationError('voidReason'),
  )
  assert.throws(
    () =>
      prepareContractChangeVoid(
        project,
        [storedChange({ statusCode: 'void' })],
        storedChange({ statusCode: 'void' }),
        actor,
        '再次作废',
      ),
    (error) =>
      error instanceof ContractChangeStateError && error.code === 'change_already_void',
  )
})

test('voiding an increase is blocked when the remaining active decreases would invalidate totals', () => {
  const prepareContractChangeVoid = requireExport('prepareContractChangeVoid')
  const project = confirmedProject()
  const increase = storedChange({
    changeId: 'increase-1',
    taxExclusiveAmount: 500000,
    taxAmount: 50000,
    taxInclusiveAmount: 550000,
  })
  const decrease = storedChange({
    changeId: 'decrease-1',
    changeType: 'decrease',
    taxExclusiveAmount: 1200000,
    taxAmount: 120000,
    taxInclusiveAmount: 1320000,
    effectiveDate: '2026-07-21',
  })

  assert.throws(
    () =>
      prepareContractChangeVoid(
        project,
        [increase, decrease],
        increase,
        actor,
        '增项不成立',
      ),
    assertValidationError('adjustedTaxExclusiveAmount'),
  )
})

test('running balances are stable, project-scoped and ignore void records without mutating input', () => {
  const buildContractChangeRunningBalances = requireExport(
    'buildContractChangeRunningBalances',
  )
  const project = confirmedProject()
  const changes = [
    storedChange({
      changeId: 'decrease-later',
      changeType: 'decrease',
      taxExclusiveAmount: 50000,
      taxAmount: 5000,
      taxInclusiveAmount: 55000,
      effectiveDate: '2026-07-22',
      createdAt: '2026-07-14T07:00:00.000Z',
    }),
    storedChange({
      changeId: 'increase-first',
      effectiveDate: '2026-07-20',
    }),
    storedChange({
      changeId: 'increase-void',
      statusCode: 'void',
      taxExclusiveAmount: 300000,
      taxAmount: 30000,
      taxInclusiveAmount: 330000,
      effectiveDate: '2026-07-21',
    }),
    storedChange({
      changeId: 'other-project',
      projectId: 'P999',
      taxExclusiveAmount: 900000,
      taxAmount: 90000,
      taxInclusiveAmount: 990000,
      effectiveDate: '2026-07-19',
    }),
  ]
  const original = clone(changes)

  const rows = buildContractChangeRunningBalances(project, changes)

  assert.deepEqual(
    rows.map((row) => [
      row.changeId,
      row.statusCode,
      row.runningTaxExclusiveAmount,
      row.runningTaxAmount,
      row.runningTaxInclusiveAmount,
    ]),
    [
      ['increase-first', 'active', 1200000, 120000, 1320000],
      ['increase-void', 'void', 1200000, 120000, 1320000],
      ['decrease-later', 'active', 1150000, 115000, 1265000],
    ],
  )
  assert.deepEqual(changes, original)
})

test('active and voided changes immediately alter every amount derived by the revenue snapshot', () => {
  const project = confirmedProject()
  const activeChange = storedChange()
  const receipts = [
    {
      receiptId: 'receipt-1',
      projectId: 'P100',
      stage: 'initial',
      taxInclusiveAmount: 550000,
      statusCode: 'active',
    },
  ]

  const activeSnapshot = buildProjectRevenueSnapshot(
    project,
    [activeChange],
    [],
    receipts,
  )
  assert.equal(activeSnapshot.adjustedTaxInclusiveAmount, 1320000)
  assert.equal(activeSnapshot.profitAnchorTaxExclusiveAmount, 1200000)
  assert.equal(activeSnapshot.outstandingTaxInclusiveAmount, 770000)
  assert.equal(activeSnapshot.paymentProgress, 42)

  const voidSnapshot = buildProjectRevenueSnapshot(
    project,
    [
      {
        ...activeChange,
        statusCode: 'void',
        voidReason: '客户取消追加内容',
      },
    ],
    [],
    receipts,
  )
  assert.equal(voidSnapshot.adjustedTaxInclusiveAmount, 1100000)
  assert.equal(voidSnapshot.profitAnchorTaxExclusiveAmount, 1000000)
  assert.equal(voidSnapshot.outstandingTaxInclusiveAmount, 550000)
  assert.equal(voidSnapshot.paymentProgress, 50)
})

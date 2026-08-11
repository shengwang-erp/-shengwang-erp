import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createServer } from 'vite'

const source = await readFile(new URL('./MiraisyaProjectPanel.jsx', import.meta.url), 'utf8').catch(() => '')

const server = await createServer({
  root: process.cwd(), configFile: false, logLevel: 'silent', appType: 'custom',
  server: { middlewareMode: true },
})
const loaded = await server.ssrLoadModule('/src/features/miraisya/MiraisyaProjectPanel.jsx')
await server.close()

test('margin uses tax-exclusive billing and authoritative project cost only', () => {
  const model = loaded.buildMiraisyaMarginModel({
    taxExclusiveAmount: 50000,
    taxAmount: 5000,
    taxInclusiveAmount: 55000,
  }, {
    ledgerSnapshot: {
      totalAmount: 30000,
      categoryTotals: [
        { category: '人工费', amount: 12000 },
        { category: '材料费', amount: 18000 },
      ],
      incompleteSources: [],
    },
  })
  assert.deepEqual(model, {
    taxExclusiveAmount: 50000,
    taxAmount: 5000,
    taxInclusiveAmount: 55000,
    totalCost: 30000,
    margin: 20000,
    complete: true,
    incompleteSources: [],
    categoryTotals: [
      { category: '人工费', amount: 12000 },
      { category: '材料费', amount: 18000 },
    ],
  })
})

test('incomplete cost sources block a numeric margin', () => {
  const model = loaded.buildMiraisyaMarginModel({
    taxExclusiveAmount: 50000, taxAmount: 5000, taxInclusiveAmount: 55000,
  }, {
    ledgerSnapshot: {
      totalAmount: 30000, categoryTotals: [], incompleteSources: ['labor'],
    },
  })
  assert.equal(model.complete, false)
  assert.equal(model.margin, null)
  assert.deepEqual(model.incompleteSources, ['labor'])
})

test('panel loads billing and costs independently and never converts costs to invoice rows', () => {
  assert.match(source, /Promise\.allSettled/)
  assert.match(source, /billingService\.get\(project\.projectId\)/)
  assert.match(source, /costLedgerService\.report\(\{ projectId: project\.projectId \}\)/)
  assert.match(source, /setBillingItems\(billing\.items\)/)
  assert.doesNotMatch(source, /setBillingItems\([^)]*(?:cost|ledger|category)/i)
  for (const copy of [
    '收费明细', '税前收入', '消费税', '含税收入',
    '自动归集成本', '总成本', '毛利', '0%', '10%',
  ]) assert.match(source, new RegExp(copy, 'u'), copy)
})

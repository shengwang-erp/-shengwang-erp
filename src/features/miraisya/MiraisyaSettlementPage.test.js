import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { buildSettlementSelectionSummary } from './miraisyaSettlementPageModel.js'

const source = await readFile(new URL('./MiraisyaSettlementPage.jsx', import.meta.url), 'utf8').catch(() => '')
const appSource = await readFile(new URL('../../App.jsx', import.meta.url), 'utf8')

test('selection summary includes carry-forward totals and blocks incomplete costs', () => {
  const candidates = [
    {
      projectId: 'p1', carriedForward: true, costComplete: true,
      taxExclusiveAmount: 10000, taxAmount: 1000, taxInclusiveAmount: 11000,
      costAmount: 3000, incompleteSources: [],
    },
    {
      projectId: 'p2', carriedForward: false, costComplete: false,
      taxExclusiveAmount: 20000, taxAmount: 2000, taxInclusiveAmount: 22000,
      costAmount: 5000, incompleteSources: ['labor'],
    },
  ]
  assert.deepEqual(buildSettlementSelectionSummary(candidates, ['p1', 'p2']), {
    selectedCount: 2,
    carriedForwardCount: 1,
    taxExclusiveAmount: 30000,
    taxAmount: 3000,
    taxInclusiveAmount: 33000,
    totalCostAmount: 8000,
    marginAmount: 22000,
    incompleteSources: ['labor'],
    canCreateDraft: false,
  })
  assert.equal(buildSettlementSelectionSummary(candidates, ['p1']).canCreateDraft, true)
})

test('page implements server-authoritative monthly draft, confirm, unfreeze, history, and download', () => {
  for (const expression of [
    /service\.listCandidates\(month\)/,
    /service\.list\(month\)/,
    /service\.createDraft\(/,
    /service\.confirm\(/,
    /service\.void\(/,
    /await reload\(\)/,
    /onDownload\(settlement\)/,
  ]) assert.match(source, expression)

  for (const copy of [
    '未来社月度结算', '结算月份', '顺延项目', '生成结算草稿', '确认冻结',
    '解冻并重新结算', '解冻原因', '历史结算', '请求书下载',
  ]) assert.match(source, new RegExp(copy, 'u'), copy)
  assert.match(source, /canManageMiraisyaSettlement\(currentUser\)/)
  assert.match(source, /disabled=\{[^}]*busy/)
})

test('App wires the protected child route and returns safely to projects', () => {
  assert.match(appSource, /MiraisyaSettlementPage/)
  assert.match(appSource, /miraisyaSettlementService/)
  assert.match(appSource, /downloadMiraisyaInvoice/)
  assert.match(appSource, /getSettlementVersion/)
  assert.match(appSource, /onDownload=\{handleMiraisyaInvoiceDownload\}/)
  assert.match(appSource, /authorizedView === 'miraisyaSettlement'/)
  assert.match(appSource, /handlePersonnelAwareNavigate\('miraisyaSettlement'\)/)
  assert.match(appSource, /handlePersonnelAwareNavigate\('projects'\)/)
})

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function readSource(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8').catch(() => '')
}

const [pageSource, changesSource, receiptsSource, cssSource] = await Promise.all([
  readSource('./ContractRevenuePage.jsx'),
  readSource('./ContractChangesSection.jsx'),
  readSource('./CustomerReceiptsSection.jsx'),
  readSource('../../styles.css'),
])

test('wide revenue tables scroll inside their sections without widening the page grid', () => {
  assert.match(
    pageSource,
    /className="app-shell page-shell contract-revenue-page"/,
  )
  assert.match(changesSource, /className="contract-change-table-wrap"/)
  assert.match(receiptsSource, /className="customer-receipt-table-wrap"/)

  assert.match(
    cssSource,
    /\.contract-revenue-page\s*>\s*\*\s*\{[^}]*min-width:\s*0\s*;?[^}]*\}/s,
  )
  assert.match(
    cssSource,
    /\.contract-change-table-wrap\s*\{[^}]*overflow-x:\s*auto\s*;?[^}]*\}/s,
  )
  assert.match(
    cssSource,
    /\.customer-receipt-table-wrap\s*\{[^}]*overflow-x:\s*auto\s*;?[^}]*\}/s,
  )
})

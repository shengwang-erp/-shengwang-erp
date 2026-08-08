import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [css, source] = await Promise.all([
  readFile(new URL('./warehouse.css', import.meta.url), 'utf8').catch(() => ''),
  readFile(new URL('./WarehouseCatalog.jsx', import.meta.url), 'utf8').catch(() => ''),
])

function selectorsFrom(sourceCss) {
  return sourceCss.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('{') && !line.startsWith('@'))
    .map((line) => line.slice(0, -1).trim())
    .flatMap((selector) => selector.split(',').map((part) => part.trim()))
}

test('warehouse catalog reuses second-version variables and every selector is page scoped', () => {
  assert.match(source, /import ['"]\.\/warehouse\.css['"]/u)
  for (const variable of [
    '--erp-bg-canvas', '--erp-bg-surface', '--erp-bg-elevated', '--erp-bg-hover',
    '--erp-border-subtle', '--erp-border-gold-muted', '--erp-accent-gold',
    '--erp-accent-gold-soft', '--erp-text-primary', '--erp-text-secondary',
    '--erp-text-muted', '--erp-focus-ring', '--erp-shadow-card',
  ]) assert.ok(css.includes(`var(${variable}`), variable)

  const selectors = selectorsFrom(css)
  assert.ok(selectors.length >= 25)
  for (const selector of selectors) {
    assert.match(selector, /^\.warehouse-management-page(?:\b|\s|>)/u, selector)
  }
  assert.doesNotMatch(css, /(^|[},])\s*(?:html|body|main|#root|\*)\s*[{,]/gmu)
})

test('mobile contract is exact 720px with touch, stacked fields, carousel and table containment', () => {
  assert.match(css, /@media\s*\(max-width:\s*720px\)\s*\{/u)
  assert.match(css, /\.warehouse-management-page[^{]*\.warehouse-catalog-form-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/su)
  assert.match(css, /\.warehouse-management-page[^{]*\.warehouse-catalog-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/su)
  assert.match(css, /\.warehouse-management-page[^{]*(?:button|\.warehouse-touch-target)[^{]*\{[^}]*min-height:\s*(?:44|4[5-9]|[5-9]\d)px/su)
  assert.match(css, /\.warehouse-management-page[^{]*\.warehouse-catalog-photo-carousel\s*\{[^}]*overflow-x:\s*auto[^}]*scroll-snap-type:\s*x\s+mandatory/su)
  assert.match(css, /\.warehouse-management-page[^{]*\.warehouse-catalog-table-wrap\s*\{[^}]*overflow-x:\s*auto[^}]*overscroll-behavior-inline:\s*contain/su)
})

test('focus is visible and warehouse catalog CSS never leaks print or global theme rules', () => {
  assert.match(css, /\.warehouse-management-page[^{]*:focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--erp-focus-ring\)[^}]*outline-offset:\s*2px/su)
  assert.doesNotMatch(css, /@media\s+print|@page|color-scheme|--erp-[\w-]+\s*:/u)
  assert.doesNotMatch(css, /\.erp-black-gold|\.warehouse-label-print-sheet/u)
  assert.match(source, /<button[^>]*className="warehouse-catalog-variant-select"[^>]*onClick=\{\(\) => chooseVariant\(variant\)\}/su)
})

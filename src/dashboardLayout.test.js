import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import postcss from 'postcss'

const [appSource, cssSource] = await Promise.all([
  readFile(
    new URL('./features/executive-dashboard/ExecutiveDashboardPage.jsx', import.meta.url),
    'utf8',
  ).catch(() => ''),
  readFile(
    new URL('./features/executive-dashboard/executiveDashboard.css', import.meta.url),
    'utf8',
  ).catch(() => ''),
])

const cssRoot = postcss.parse(cssSource, { from: 'executiveDashboard.css' })

function rulesFor(selector) {
  const matches = []
  cssRoot.walkRules((rule) => {
    if (rule.selectors.includes(selector)) matches.push(rule)
  })
  return matches
}

function declarations(rule) {
  return new Map(
    rule.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value]),
  )
}

function mediaParams(rule) {
  return rule.parent?.type === 'atrule' && rule.parent.name === 'media'
    ? rule.parent.params.replace(/\s+/gu, ' ').trim()
    : ''
}

test('executive dashboard owns a scroll wrapper around its project table', () => {
  assert.match(
    appSource,
    /<div className="executive-project-table-scroll"[\s\S]*?<table className="executive-project-table">/u,
  )
  const [scrollRule] = rulesFor('.erp-black-gold .executive-project-table-scroll')
  assert.ok(scrollRule)
  const scrollDeclarations = declarations(scrollRule)
  assert.equal(scrollDeclarations.get('max-width'), '100%')
  assert.equal(scrollDeclarations.get('overflow-x'), 'auto')
  assert.notEqual(scrollDeclarations.get('max-height'), '1px')
  assert.notEqual(scrollDeclarations.get('overflow'), 'hidden')
})

test('executive dashboard uses one, two, and twelve-column responsive layouts', () => {
  const gridRules = rulesFor('.erp-black-gold .executive-dashboard-grid')
  const gridByTier = new Map(gridRules.map((rule) => [mediaParams(rule), declarations(rule)]))
  assert.equal(gridByTier.get('')?.get('grid-template-columns'), 'minmax(0, 1fr)')
  assert.equal(
    gridByTier.get('(min-width: 768px) and (max-width: 1023px)')
      ?.get('grid-template-columns'),
    'repeat(2, minmax(0, 1fr))',
  )
  assert.equal(
    gridByTier.get('(min-width: 1024px)')?.get('grid-template-columns'),
    'repeat(12, minmax(0, 1fr))',
  )

  const tiers = []
  cssRoot.walkAtRules('media', (atRule) => tiers.push(atRule.params.replace(/\s+/gu, ' ').trim()))
  assert.deepEqual(tiers.sort(), [
    '(max-width: 767px)',
    '(min-width: 1024px)',
    '(min-width: 768px) and (max-width: 1023px)',
  ].sort())
})

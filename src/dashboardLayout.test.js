import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

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

test('executive dashboard owns a scroll wrapper around its project table', () => {
  assert.match(
    appSource,
    /<div className="executive-project-table-scroll"[\s\S]*?<table className="executive-project-table">/u,
  )
  assert.match(
    cssSource,
    /\.erp-black-gold\s+\.executive-project-table-scroll\s*\{[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto/,
  )
})

test('executive dashboard uses one, two, and twelve-column responsive layouts', () => {
  assert.match(
    cssSource,
    /\.erp-black-gold\s+\.executive-dashboard-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
  )
  assert.match(
    cssSource,
    /@media\s*\(min-width:\s*768px\)\s*and\s*\(max-width:\s*1023px\)[\s\S]*?\.erp-black-gold\s+\.executive-dashboard-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/u,
  )
  assert.match(
    cssSource,
    /@media\s*\(min-width:\s*1024px\)[\s\S]*?\.erp-black-gold\s+\.executive-dashboard-grid\s*\{[^}]*grid-template-columns:\s*repeat\(12,\s*minmax\(0,\s*1fr\)\)/u,
  )
})

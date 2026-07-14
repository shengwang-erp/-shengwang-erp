import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [appSource, cssSource] = await Promise.all([
  readFile(new URL('./App.jsx', import.meta.url), 'utf8'),
  readFile(new URL('./styles.css', import.meta.url), 'utf8'),
])

test('owner dashboard project table scrolls inside its desktop container', () => {
  const dashboardStart = appSource.indexOf('function DashboardPage')
  const dashboardEnd = appSource.indexOf('function PageShell')

  assert.ok(dashboardStart >= 0 && dashboardEnd > dashboardStart)

  const dashboardSource = appSource.slice(dashboardStart, dashboardEnd)

  assert.match(
    dashboardSource,
    /<SectionTitle title="项目收款明细表"[\s\S]*?<div className="payment-table-wrap owner-dashboard-project-table-wrap">[\s\S]*?<table className="payment-table">/,
  )
  assert.match(
    cssSource,
    /@media\s*\(min-width:\s*721px\)\s*\{\s*\.owner-dashboard-project-table-wrap\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto[^}]*\}\s*\}/s,
  )
})

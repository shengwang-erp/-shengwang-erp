import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMonthWindow, isDateInMonth, monthOfDate, normalizeMonth } from './dashboardTime.js'

test('buildMonthWindow returns twelve ordered months across a year boundary', () => {
  assert.deepEqual(buildMonthWindow('2026-02', 12), [
    '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08',
    '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02',
  ])
})

test('month parsing rejects invalid calendar months and accepts exact ISO dates', () => {
  assert.equal(normalizeMonth('2026-13'), '')
  assert.equal(normalizeMonth('1899-12'), '')
  assert.equal(normalizeMonth('2101-01'), '')
  assert.equal(normalizeMonth('2026-07'), '2026-07')
  assert.equal(monthOfDate('2026-02-31'), '')
  assert.equal(isDateInMonth('2026-07-31', '2026-07'), true)
  assert.equal(isDateInMonth('2026-08-01', '2026-07'), false)
})

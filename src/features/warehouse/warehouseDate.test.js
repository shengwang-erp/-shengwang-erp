import assert from 'node:assert/strict'
import test from 'node:test'

import { formatTokyoDateTime, tokyoDate, tokyoMonth } from './warehouseDate.js'

test('warehouse dates use the Tokyo calendar at UTC boundaries', () => {
  const beforeTokyoMidnight = new Date('2026-08-05T14:59:59.000Z')
  const afterTokyoMidnight = new Date('2026-08-05T15:00:00.000Z')

  assert.equal(tokyoDate(beforeTokyoMidnight), '2026-08-05')
  assert.equal(tokyoDate(afterTokyoMidnight), '2026-08-06')
  assert.equal(formatTokyoDateTime(afterTokyoMidnight), '2026-08-06 00:00')
})

test('Tokyo month rolls over independently of the host timezone', () => {
  assert.equal(tokyoMonth(new Date('2026-08-31T14:59:59.000Z')), '2026-08')
  assert.equal(tokyoMonth(new Date('2026-08-31T15:00:00.000Z')), '2026-09')
})

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const CONTRACT_REVENUE_TABLES = [
  'project_contract_changes',
  'project_payment_plans',
  'project_receipts',
]

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test('main Supabase initialization SQL creates every contract revenue table', () => {
  const sql = readFileSync(
    new URL('../../docs/supabase-schema.sql', import.meta.url),
    'utf8',
  )

  for (const tableName of CONTRACT_REVENUE_TABLES) {
    assert.match(
      sql,
      new RegExp(
        `select public\\.create_erp_record_table\\('${escapeRegExp(tableName)}'\\);`,
      ),
    )
  }
})

test('standalone contract revenue migration SQL is repeatable and non-destructive', () => {
  const sql = readFileSync(
    new URL(
      '../../docs/migrations/2026-07-14-contract-revenue-chain.sql',
      import.meta.url,
    ),
    'utf8',
  )

  assert.match(sql, /create extension if not exists pgcrypto;/i)
  assert.match(
    sql,
    /create or replace function public\.create_contract_revenue_record_table\(target_table text\)/i,
  )
  assert.match(sql, /create table if not exists public\.%I/i)
  assert.match(sql, /drop policy if exists/i)
  assert.match(sql, /drop trigger if exists/i)
  assert.match(
    sql,
    /drop function if exists public\.create_contract_revenue_record_table\(text\);/i,
  )
  assert.doesNotMatch(sql, /drop\s+table/i)

  for (const tableName of CONTRACT_REVENUE_TABLES) {
    assert.match(
      sql,
      new RegExp(
        `select public\\.create_contract_revenue_record_table\\('${escapeRegExp(tableName)}'\\);`,
      ),
    )
  }
})

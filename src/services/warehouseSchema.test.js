import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migration = await readFile(new URL(
  '../../supabase/migrations/202608080002_warehouse_foundation.sql',
  import.meta.url,
), 'utf8').catch(() => '')

function stripSqlCommentsStringsAndRoutineBodies(source) {
  let output = ''
  let index = 0
  let blockDepth = 0

  while (index < source.length) {
    if (blockDepth > 0) {
      if (source.startsWith('/*', index)) {
        blockDepth += 1
        output += '  '
        index += 2
      } else if (source.startsWith('*/', index)) {
        blockDepth -= 1
        output += '  '
        index += 2
      } else {
        output += source[index] === '\n' ? '\n' : ' '
        index += 1
      }
      continue
    }

    if (source.startsWith('--', index)) {
      const lineEnd = source.indexOf('\n', index + 2)
      const end = lineEnd === -1 ? source.length : lineEnd
      output += ' '.repeat(end - index)
      index = end
      continue
    }

    if (source.startsWith('/*', index)) {
      blockDepth = 1
      output += '  '
      index += 2
      continue
    }

    if (source[index] === "'") {
      output += ' '
      index += 1
      let closed = false
      while (index < source.length) {
        if (source[index] === "'" && source[index + 1] === "'") {
          output += '  '
          index += 2
        } else if (source[index] === "'") {
          output += ' '
          index += 1
          closed = true
          break
        } else {
          output += source[index] === '\n' ? '\n' : ' '
          index += 1
        }
      }
      if (!closed) {
        throw new Error('unterminated SQL string')
      }
      continue
    }

    if (source[index] === '$') {
      const tag = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0]
      if (tag) {
        const statementStart = output.lastIndexOf(';') + 1
        const statementPrefix = output.slice(statementStart)
        const startsRoutineBody = /^\s*create\s+(?:or\s+replace\s+)?(?:function|procedure)\b[\s\S]*\bas\s*$/i
          .test(statementPrefix)
        if (startsRoutineBody) {
          const bodyEnd = source.indexOf(tag, index + tag.length)
          if (bodyEnd === -1) {
            throw new Error('unterminated SQL dollar body')
          }
          const end = bodyEnd + tag.length
          const body = source.slice(index, end)
          output += body.replace(/[^\n]/g, ' ')
          index = end
          continue
        }

        output += tag
        index += tag.length
        continue
      }
    }

    output += source[index]
    index += 1
  }

  if (blockDepth > 0) {
    throw new Error('unterminated SQL block comment')
  }

  return output
}

function protectedTopLevelDml(source) {
  const stripped = stripSqlCommentsStringsAndRoutineBodies(source)
  if (/(?:^|;)\s*do\b/i.test(stripped)) {
    throw new Error('top-level DO blocks are forbidden')
  }
  const protectedTarget = '(?:public\\.)?(?:employee_profiles|projects|permission_grants)'
  const dml = new RegExp(
    `\\b(?:insert\\s+into|update|delete\\s+from|merge\\s+into|truncate(?:\\s+table)?)\\s+(?:only\\s+)?${protectedTarget}\\b`,
    'gi',
  )
  return [...stripped.matchAll(dml)].map((match) => match[0])
}

const expectedTables = [
  'warehouse_sites',
  'warehouse_locations',
  'warehouse_items',
  'warehouse_variants',
  'warehouse_batches',
  'warehouse_batch_locations',
  'warehouse_inventory_movements',
]

test('warehouse migration creates the normalized foundation with explicit numeric precision', () => {
  for (const table of expectedTables) {
    assert.match(
      migration,
      new RegExp(`create table public\\.${table}\\b`, 'i'),
      `missing normalized table ${table}`,
    )
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table} enable row level security`, 'i'),
      `missing RLS on ${table}`,
    )
  }

  assert.match(migration, /quantity_delta\s+numeric\(18,\s*3\)/i)
  assert.match(migration, /original_quantity\s+numeric\(18,\s*3\)/i)
  assert.match(migration, /quantity\s+numeric\(18,\s*3\)/i)
  assert.match(migration, /unit_cost\s+numeric\(18,\s*4\)/i)
  assert.match(migration, /default_purchase_price\s+numeric\(18,\s*4\)/i)
})

test('warehouse identifiers, QR values and ledger relationships are database constrained', () => {
  for (const name of [
    'warehouse_sites_code_unique',
    'warehouse_locations_warehouse_shelf_unique',
    'warehouse_variants_sku_unique',
    'warehouse_variants_system_qr_unique',
    'warehouse_variants_manufacturer_qr_ci_unique',
    'warehouse_movements_idempotency_unique',
    'warehouse_movements_reversal_unique',
  ]) {
    assert.match(migration, new RegExp(name, 'i'), `missing constraint/index ${name}`)
  }

  assert.match(migration, /SWERP:VARIANT:/i)
  assert.match(migration, /references public\.employee_profiles\(id\) on delete restrict/i)
  assert.match(migration, /references public\.projects\(record_key\) on delete restrict/i)
  assert.match(migration, /references public\.warehouse_inventory_movements\(id\) on delete restrict/i)
})

test('warehouse browser access is read-only and cost columns are not directly selectable', () => {
  assert.match(
    migration,
    /create policy "warehouse_sites inventory read"[\s\S]*public\.has_current_permission\('module\.inventory\.view'\)/i,
  )
  assert.match(
    migration,
    /grant select \([^)]+\) on table public\.warehouse_variants to authenticated/i,
  )
  assert.doesNotMatch(
    migration,
    /grant select\s+on table public\.warehouse_(variants|batches|inventory_movements) to authenticated/i,
  )
  for (const table of [
    'warehouse_batches',
    'warehouse_batch_locations',
    'warehouse_inventory_movements',
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, 'i'),
      `missing direct-write closure for ${table}`,
    )
  }
})

test('warehouse permission assertion is fail-closed and movement rows are immutable', () => {
  assert.match(
    migration,
    /create or replace function private\.assert_warehouse_permission\(p_permission_key text\)/i,
  )
  assert.match(migration, /auth_user_id\s*=\s*auth\.uid\(\)/i)
  assert.match(migration, /employment_status\s*<>\s*'在职'/i)
  assert.match(migration, /account_status\s*<>\s*'active'/i)
  assert.match(migration, /must_change_password\s*<>\s*false/i)
  assert.match(migration, /public\.has_current_permission\(p_permission_key\)/i)
  assert.match(
    migration,
    /create trigger reject_warehouse_movement_mutation\s+before update or delete\s+on public\.warehouse_inventory_movements/i,
  )
  assert.match(migration, /warehouse inventory movements are immutable/i)
})

test('top-level protected-table DML detector ignores comments, strings and function bodies', () => {
  const decoys = `
    -- update public.projects set status = 'deleted';
    /* delete from public.employee_profiles; /* nested comment */ */
    select 'truncate public.permission_grants';
    create function private.decoy() returns void language plpgsql as $routine_body_17$
    begin
      /* update public.employee_profiles set deleted_at = now(); /* nested */ */
      perform 'delete from public.permission_grants';
      insert into public.projects(record_key) values ('inside-function');
    end
    $routine_body_17$;
    create procedure private.decoy_procedure() language plpgsql as $procedure_body$
    begin
      update public.employee_profiles set deleted_at = now();
    end
    $procedure_body$;
  `
  assert.deepEqual(protectedTopLevelDml(decoys), [])
  assert.deepEqual(
    protectedTopLevelDml('merge into public.permission_grants as target using source on true;'),
    ['merge into public.permission_grants'],
  )
})

test('top-level protected-table DML detector forbids executable DO dollar bodies', () => {
  assert.throws(
    () => protectedTopLevelDml(`
      do $executable$
      begin
        update public.projects set status = 'deleted';
      end
      $executable$;
    `),
    /top-level DO blocks are forbidden/,
  )
})

test('top-level protected-table DML detector scans non-routine dollar content', () => {
  assert.deepEqual(
    protectedTopLevelDml(`select $review_probe$
      update public.projects set status = 'deleted';
    $review_probe$`),
    ['update public.projects'],
  )
})

test('top-level protected-table DML detector fails closed on unterminated SQL bodies', () => {
  for (const malformed of [
    "select 'unterminated",
    '/* unterminated block comment',
    'create function private.bad() returns void as $body$ begin',
  ]) {
    assert.throws(
      () => protectedTopLevelDml(malformed),
      /unterminated SQL (string|block comment|dollar body)/,
    )
  }
})

test('warehouse foundation performs no top-level employee, project or grant DML', () => {
  assert.deepEqual(protectedTopLevelDml(migration), [])
})

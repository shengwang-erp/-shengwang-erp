import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sql = await readFile(new URL('../../supabase/migrations/202607150002_project_documents.sql', import.meta.url), 'utf8').catch(() => '')

test('document rows are immutable and browser table access is closed', () => {
  assert.match(sql, /create table(?: if not exists)? public\.project_document_logicals/i)
  assert.match(sql, /create table(?: if not exists)? public\.project_documents/i)
  assert.match(sql, /create trigger project_document_immutable\s+before update or delete on public\.project_documents[\s\S]+?execute function private\.reject_project_document_mutation\(\)/i)
  assert.match(sql, /if tg_op\s*=\s*'DELETE' then raise exception 'project document rows are immutable'/i)
  assert.match(sql, /revoke all on\s+public\.project_document_logicals\s*,\s*public\.project_documents\s*,\s*public\.project_document_events\s+from\s+anon\s*,\s*authenticated/i)
  assert.doesNotMatch(sql, /create policy[\s\S]+storage\.objects[\s\S]+to authenticated/i)
})

test('document contract includes immutable metadata, safe RPCs and closed execution', () => {
  for (const name of ['project_document_events','list_project_documents_secure','list_project_document_history_secure','list_my_incomplete_project_documents_secure','abandon_project_document_upload_secure','void_project_document_secure','list_deleted_project_archive_secure','list_deleted_project_documents_secure']) assert.match(sql, new RegExp(name, 'i'))
  assert.match(sql, /check\s*\(\s*object_path\s*=\s*project_id\s*\|\|\s*'\/'\s*\|\|\s*document_id::text\s*\|\|\s*'\/'\s*\|\|\s*version::text\s*\)/i)
  assert.match(sql, /create trigger project_document_event_immutable\s+before update or delete on public\.project_document_events[\s\S]+?execute function private\.reject_document_event_mutation\(\)/i)
  assert.match(sql, /reject_document_event_mutation\(\)[\s\S]+?raise exception 'document events are append only'/i)
  assert.match(sql, /unique\s*\(\s*logical_document_id\s*,\s*version\s*\)/i)
  assert.match(sql, /on delete restrict/i)
  assert.match(sql, /revoke all on function public\.list_project_documents_secure/i)
  assert.match(sql, /grant execute on function public\.list_project_documents_secure[^;]*to authenticated/i)
  assert.doesNotMatch(sql, /contract_change_id|project_contract_changes/i)
})
